#requires -Version 7.2
<#
Read/check by default; -Execute explicitly authorizes one temporary, exact-object IAM binding.
No files, tokens, addresses or document contents are written to disk or output.
IAM v3 + etag references:
https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/getIamPolicy
https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/setIamPolicy
https://docs.cloud.google.com/storage/docs/access-control/iam#conditions
Examples:
  ./scripts/verify-restored-report-files.ps1 -Project kreatum-dinamic-staging -Check
  ./scripts/verify-restored-report-files.ps1 -Project kreatum-dinamic-staging -Execute
The named database is an already restored copy; this verifies referenced files, not full DR.
#>
[CmdletBinding(DefaultParameterSetName = 'Check')]
param(
  [Parameter(Mandatory)][ValidateSet('kreatum-dinamic-staging')][string]$Project,
  [Parameter(ParameterSetName = 'Check')][switch]$Check,
  [Parameter(Mandatory, ParameterSetName = 'Execute')][switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Verification([string]$Code, [int]$HttpStatus = 0) {
  $failure = [InvalidOperationException]::new('Isolated recovery verification stopped.')
  $failure.Data['SafeCode'] = $Code
  if ($HttpStatus -ge 100 -and $HttpStatus -le 599) { $failure.Data['HttpStatus'] = $HttpStatus }
  throw $failure
}

function Get-SafeFailure($Failure) {
  $result = @{ code = 'verification-failed' }
  if ($Failure.Exception.Data['SafeCode'] -match '^[a-z-]{3,64}$') { $result.code = $Failure.Exception.Data['SafeCode'] }
  $status = $Failure.Exception.Data['HttpStatus']
  if ($status -is [int] -and $status -ge 100 -and $status -le 599) { $result.httpStatus = $status }
  return $result
}

function Get-RestoredArtifacts($QueryResults) {
  $documents = @($QueryResults | Where-Object { $_['document'] })
  if ($documents.Count -ne 2) { Stop-Verification 'unexpected-report-count' }
  $artifacts = [Collections.Generic.List[object]]::new()
  foreach ($entry in $documents) {
    $document = $entry['document']
    if ($document['name'] -notmatch '^projects/kreatum-dinamic-staging/databases/security-restore-20260911/documents/(?:[A-Za-z0-9_-]+/)+reports/[A-Za-z0-9_-]+$') { Stop-Verification 'invalid-restored-document' }
    $fields = $document['fields']['artifacts']['mapValue']['fields']
    if (-not $fields -or $fields.Count -ne 3) { Stop-Verification 'unexpected-artifact-count' }
    foreach ($format in @('pdf', 'pptx', 'json')) {
      $item = $fields[$format]['mapValue']['fields']
      $objectPath = [string]$item['storagePath']['stringValue']
      $sha = [string]$item['sha256']['stringValue']
      $size = 0L
      if ($objectPath -notmatch '^organizations/[A-Za-z0-9_-]+/workshops/[A-Za-z0-9_-]+/reports/[A-Za-z0-9_-]+\.(pdf|pptx|json)$') { Stop-Verification 'invalid-artifact-path' }
      if (-not $objectPath.EndsWith('.' + $format, [StringComparison]::OrdinalIgnoreCase)) { Stop-Verification 'artifact-format-mismatch' }
      if ($sha -notmatch '^[a-fA-F0-9]{64}$') { Stop-Verification 'invalid-artifact-hash' }
      if (-not [long]::TryParse([string]$item['size']['integerValue'], [ref]$size) -or $size -le 0 -or $size -gt 64MB) { Stop-Verification 'invalid-artifact-size' }
      $artifacts.Add(@{ path = $objectPath; sha256 = $sha.ToLowerInvariant(); size = $size; format = $format })
    }
  }
  if ($artifacts.Count -ne 6 -or @($artifacts.path | Sort-Object -Unique).Count -ne 6) { Stop-Verification 'duplicate-or-missing-artifacts' }
  return ,$artifacts.ToArray()
}

function New-ReadBinding($Artifacts, [string]$Member, [string]$Title, [DateTimeOffset]$Now) {
  if ($Member -notmatch '^user:[^\s:@]+@[^\s:@]+$' -or $Member.EndsWith('.gserviceaccount.com')) { Stop-Verification 'configured-user-required' }
  if ($Title -notmatch '^security-restore-[a-f0-9]{32}$' -or @($Artifacts).Count -ne 6) { Stop-Verification 'invalid-binding-scope' }
  $resources = foreach ($artifact in $Artifacts) {
    if ($artifact.path -notmatch '^organizations/[A-Za-z0-9_-]+/workshops/[A-Za-z0-9_-]+/reports/[A-Za-z0-9_-]+\.(pdf|pptx|json)$') { Stop-Verification 'invalid-binding-scope' }
    '"projects/_/buckets/kreatum-dinamic-staging.firebasestorage.app/objects/' + $artifact.path + '"'
  }
  if (@($resources | Sort-Object -Unique).Count -ne 6) { Stop-Verification 'invalid-binding-scope' }
  $expires = $Now.ToUniversalTime().AddHours(1).ToString('yyyy-MM-ddTHH:mm:ssZ')
  return @{
    role = 'roles/storage.objectViewer'; members = @($Member)
    condition = @{ title = $Title; description = 'Isolated restored report integrity check; six exact objects; expires within one hour.'; expression = '(resource.name in [' + ($resources -join ', ') + ']) && request.time < timestamp("' + $expires + '")' }
  }
}

function Copy-Policy($Policy) {
  if ([string]::IsNullOrWhiteSpace([string]$Policy['etag']) -or -not $Policy.Contains('bindings')) { Stop-Verification 'policy-etag-or-bindings-missing' }
  if ([int]$Policy['version'] -notin @(1, 3)) { Stop-Verification 'unsupported-policy-version' }
  return ($Policy | ConvertTo-Json -Depth 100 -Compress | ConvertFrom-Json -AsHashtable)
}

function Add-ReadBinding($Policy, $Binding) {
  $copy = Copy-Policy $Policy
  if (@($copy.bindings | Where-Object { $_['condition'] -and $_['condition']['title'] -eq $Binding.condition.title }).Count) { Stop-Verification 'binding-title-collision' }
  $copy.version = 3
  $copy.bindings = @($copy.bindings) + @($Binding)
  return $copy
}

function Remove-ReadBinding($Policy, $Binding) {
  $copy = Copy-Policy $Policy
  $matches = @($copy.bindings | Where-Object { $_['condition'] -and $_['condition']['title'] -eq $Binding.condition.title })
  if ($matches.Count -eq 0) { return $null }
  if ($matches.Count -ne 1 -or $matches[0].role -ne $Binding.role -or @($matches[0].members).Count -ne 1 -or $matches[0].members[0] -cne $Binding.members[0] -or $matches[0].condition.expression -cne $Binding.condition.expression) { Stop-Verification 'own-binding-was-modified' }
  $copy.version = 3
  $copy.bindings = @($copy.bindings | Where-Object { -not ($_['condition'] -and $_['condition']['title'] -eq $Binding.condition.title) })
  return $copy
}

function Test-ArtifactBytes([byte[]]$Bytes, $Artifact) {
  if ($Bytes.LongLength -ne $Artifact.size) { Stop-Verification 'artifact-size-mismatch' }
  $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
  if ($actual -cne $Artifact.sha256) { Stop-Verification 'artifact-hash-mismatch' }
  switch ($Artifact.format) {
    'pdf' { if ($Bytes.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($Bytes, 0, 5) -cne '%PDF-') { Stop-Verification 'artifact-magic-mismatch' } }
    'pptx' {
      if ($Bytes.Length -lt 4 -or $Bytes[0] -ne 80 -or $Bytes[1] -ne 75 -or $Bytes[2] -ne 3 -or $Bytes[3] -ne 4) { Stop-Verification 'artifact-magic-mismatch' }
      $memory = [IO.MemoryStream]::new($Bytes, $false)
      $archive = $null
      try {
        $archive = [IO.Compression.ZipArchive]::new($memory, [IO.Compression.ZipArchiveMode]::Read, $false)
        if (-not $archive.GetEntry('ppt/presentation.xml')) { Stop-Verification 'artifact-magic-mismatch' }
      } finally { if ($archive) { $archive.Dispose() }; $memory.Dispose() }
    }
    'json' {
      $json = $null
      try { $json = [Text.Json.JsonDocument]::Parse([Text.UTF8Encoding]::new($false, $true).GetString($Bytes)) }
      catch { Stop-Verification 'artifact-json-invalid' }
      finally { if ($json) { $json.Dispose() } }
    }
    default { Stop-Verification 'artifact-format-mismatch' }
  }
  return $true
}

function Invoke-GcloudPrivate([string[]]$Arguments) {
  $value = @(& gcloud @Arguments --quiet 2>$null)
  if ($LASTEXITCODE -ne 0) { Stop-Verification 'configured-credential-failed' }
  return ($value -join "`n").Trim()
}

function Invoke-PrivateRequest($Client, [string]$Method, [string]$Url, $Body = $null, [long]$MaximumBytes = 2MB, [switch]$Binary) {
  $uri = [Uri]$Url
  $allowed = ($uri.Host -eq 'firestore.googleapis.com' -and $uri.AbsolutePath -eq '/v1/projects/kreatum-dinamic-staging/databases/security-restore-20260911/documents:runQuery' -and $Method -eq 'POST') -or
    ($uri.Host -eq 'storage.googleapis.com' -and $uri.AbsolutePath.StartsWith('/storage/v1/b/kreatum-dinamic-staging.firebasestorage.app/') -and $Method -in @('GET', 'PUT'))
  if (-not $allowed -or $uri.Scheme -ne 'https') { Stop-Verification 'request-outside-staging-scope' }
  if ($Method -eq 'PUT' -and $uri.AbsolutePath -ne '/storage/v1/b/kreatum-dinamic-staging.firebasestorage.app/iam') { Stop-Verification 'object-write-forbidden' }
  if ($uri.Host -eq 'storage.googleapis.com' -and $uri.AbsolutePath.EndsWith('/o')) { Stop-Verification 'object-list-forbidden' }
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $uri)
  $response = $null; $stream = $null; $memory = $null
  try {
    if ($null -ne $Body) { $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 100 -Compress), [Text.Encoding]::UTF8, 'application/json') }
    $response = $Client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { Stop-Verification 'cloud-http-rejected' ([int]$response.StatusCode) }
    if ($response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $MaximumBytes) { Stop-Verification 'response-too-large' }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $memory = [IO.MemoryStream]::new()
    $buffer = [byte[]]::new(65536)
    while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if ($memory.Length + $count -gt $MaximumBytes) { Stop-Verification 'response-too-large' }
      $memory.Write($buffer, 0, $count)
    }
    $bytes = $memory.ToArray()
    if ($Binary) { return ,$bytes }
    return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable -Depth 100)
  } finally {
    if ($memory) { $memory.Dispose() }; if ($stream) { $stream.Dispose() }
    if ($response) { $response.Dispose() }; $request.Dispose()
  }
}

$stage = 'configuration'; $client = $null; $handler = $null; $binding = $null
$grantAttempted = $false; $removed = $false; $checked = 0; $failure = $null; $cleanupFailure = $null
$runId = 'security-restore-' + [Guid]::NewGuid().ToString('N')
$result = @{ runId = $runId; mode = $(if ($Execute) { 'execute' } else { 'check' }); reports = 0; references = 0; verified = 0; hashChecks = 'not-run'; iamChanged = $false; cleanup = 'not-needed' }
try {
  foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Value -and $entry.Name -match 'EMULATOR|IMPERSONATE|CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE|CLOUDSDK_AUTH_ACCESS_TOKEN') { Stop-Verification 'alternate-credentials-or-emulator-forbidden' }
  }
  $impersonation = Invoke-GcloudPrivate @('config', 'get-value', 'auth/impersonate_service_account')
  if ($impersonation -and $impersonation -ne '(unset)') { Stop-Verification 'impersonation-forbidden' }
  $account = Invoke-GcloudPrivate @('config', 'get-value', 'account')
  if ($account -notmatch '^[^\s:@]+@[^\s:@]+$' -or $account.EndsWith('.gserviceaccount.com')) { Stop-Verification 'configured-user-required' }
  $stage = 'credentials'
  $token = Invoke-GcloudPrivate @('auth', 'print-access-token', '--account', $account)
  if ([string]::IsNullOrWhiteSpace($token)) { Stop-Verification 'configured-credential-failed' }
  $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromSeconds(60)
  $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
  $null = $client.DefaultRequestHeaders.TryAddWithoutValidation('x-goog-user-project', 'kreatum-dinamic-staging')
  $token = $null
  $stage = 'restored-references'
  $query = @{ structuredQuery = @{ select = @{ fields = @(@{ fieldPath = 'artifacts' }) }; from = @(@{ collectionId = 'reports'; allDescendants = $true }); limit = 3 } }
  $references = Invoke-PrivateRequest $client 'POST' 'https://firestore.googleapis.com/v1/projects/kreatum-dinamic-staging/databases/security-restore-20260911/documents:runQuery' $query
  $artifacts = Get-RestoredArtifacts $references
  $result.reports = 2; $result.references = 6
  $iamUrl = 'https://storage.googleapis.com/storage/v1/b/kreatum-dinamic-staging.firebasestorage.app/iam'
  $stage = 'iam-read'
  $policy = Invoke-PrivateRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3')
  $binding = New-ReadBinding $artifacts ('user:' + $account) $runId ([DateTimeOffset]::UtcNow)
  $newPolicy = Add-ReadBinding $policy $binding
  if ($Execute) {
    $stage = 'iam-grant'; $grantAttempted = $true
    $null = Invoke-PrivateRequest $client 'PUT' $iamUrl $newPolicy
    $result.iamChanged = $true
    $stage = 'iam-grant-readback'
    $readback = Invoke-PrivateRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3')
    if (-not (Remove-ReadBinding $readback $binding)) { Stop-Verification 'grant-readback-missing' }
    $stage = 'iam-propagation'
    @{ stage = $stage; seconds = 60 } | ConvertTo-Json -Compress
    Start-Sleep -Seconds 60
    $stage = 'artifact-integrity'
    foreach ($artifact in $artifacts) {
      $objectUrl = 'https://storage.googleapis.com/storage/v1/b/kreatum-dinamic-staging.firebasestorage.app/o/' + [Uri]::EscapeDataString($artifact.path)
      $metadata = Invoke-PrivateRequest $client 'GET' ($objectUrl + '?fields=size,generation')
      if ([string]$metadata['generation'] -notmatch '^\d+$' -or [long]$metadata['size'] -ne $artifact.size) { Stop-Verification 'metadata-size-or-generation-mismatch' }
      $bytes = $null
      try {
        $bytes = Invoke-PrivateRequest $client 'GET' ($objectUrl + '?alt=media&generation=' + $metadata['generation']) -MaximumBytes $artifact.size -Binary
        $null = Test-ArtifactBytes $bytes $artifact
        $checked++
      } finally { if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }; $bytes = $null }
    }
    $result.hashChecks = 'all-match'
  }
} catch { $failure = Get-SafeFailure $_; $failure.stage = $stage }
finally {
  if ($grantAttempted -and $client -and $binding) {
    try {
      $stage = 'iam-cleanup'
      # Fresh policy/etag retains unrelated changes. Retry ONLY optimistic-concurrency 412, never 403.
      for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $current = Invoke-PrivateRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3')
        $withoutOwnBinding = Remove-ReadBinding $current $binding
        if ($null -ne $withoutOwnBinding) {
          try { $null = Invoke-PrivateRequest $client 'PUT' $iamUrl $withoutOwnBinding }
          catch { if ($_.Exception.Data['HttpStatus'] -eq 412 -and $attempt -lt 2) { continue }; throw }
        }
        $verify = Invoke-PrivateRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3')
        if (@($verify.bindings | Where-Object { $_['condition'] -and $_['condition']['title'] -eq $runId }).Count -ne 0) { Stop-Verification 'cleanup-readback-failed' }
        $removed = $true; break
      }
      if (-not $removed) { Stop-Verification 'cleanup-not-confirmed' }
      $result.cleanup = 'own-binding-absent-verified'
    } catch { $cleanupFailure = Get-SafeFailure $_; $result.cleanup = 'failed-review-required-binding-expires-within-one-hour' }
  }
  if ($client) { $client.Dispose() }; if ($handler) { $handler.Dispose() }
  $account = $null; $references = $null; $artifacts = $null; $binding = $null; $policy = $null; $token = $null
}
$result.verified = $checked
if ($failure -or $cleanupFailure) {
  $result.status = 'failed'; if ($failure) { $result.failure = $failure }; if ($cleanupFailure) { $result.cleanupFailure = $cleanupFailure }
  $result | ConvertTo-Json -Depth 6 -Compress
  exit 1
}
$result.status = $(if ($Execute -and $checked -eq 6 -and $removed) { 'verified' } elseif (-not $Execute) { 'check-passed-no-mutation' } else { 'incomplete' })
$result | ConvertTo-Json -Depth 6 -Compress
if ($result.status -eq 'incomplete') { exit 1 }
