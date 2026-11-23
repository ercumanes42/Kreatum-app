#requires -Version 7.2
<#
Check is read-only. Execute creates TWO independent temporary buckets in staging only.
All live organizations/ objects (not deleted versions) are copied, maximum 200 / 512 MiB.
Source and original objects are never deleted or changed. Seven-day lifecycle applies
ONLY to the new copies; seven-day soft delete means storage charges can last longer.
This proves object recovery, NOT application recovery or a production backup strategy.
References:
https://docs.cloud.google.com/storage/docs/json_api/v1/objects/rewrite
https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/insert
https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/setIamPolicy
#>
[CmdletBinding(DefaultParameterSetName = 'Check')]
param(
  [Parameter(ParameterSetName = 'Check')][switch]$Check,
  [Parameter(Mandatory, ParameterSetName = 'Execute')][switch]$Execute,
  [Parameter(Mandatory, ParameterSetName = 'Resume')][switch]$Resume
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Recovery([string]$Code, [int]$Status = 0) {
  $errorValue = [InvalidOperationException]::new('Staging recovery stopped; sensitive details suppressed.')
  $errorValue.Data['SafeCode'] = $Code
  $errorValue.Data['HttpStatus'] = $Status
  throw $errorValue
}
function Get-RecoveryFailure($Failure) {
  $safe = @{ code = 'recovery-failed' }
  if ($Failure.Exception.Data['SafeCode'] -match '^[a-z-]{3,64}$') { $safe.code = $Failure.Exception.Data['SafeCode'] }
  $status = $Failure.Exception.Data['HttpStatus']
  if ($status -is [int] -and $status -ge 100 -and $status -le 599) { $safe.httpStatus = $status }
  foreach ($field in @('Operation', 'CloudReason', 'ErrorClass')) {
    if ($Failure.Exception.Data[$field] -cmatch '^[a-zA-Z-]{3,64}$') { $safe[$field] = $Failure.Exception.Data[$field] }
  }
  return $safe
}
function Get-RecoveryCloudError([byte[]]$Bytes) {
  $safe = @{ CloudReason = 'unclassified'; ErrorClass = 'unclassified' }
  try {
    $body = [Text.Encoding]::UTF8.GetString($Bytes) | ConvertFrom-Json -AsHashtable -Depth 20
    $reason = [string](@($body['error']['errors'])[0]['reason'])
    if ($reason -cin @('invalid', 'invalidArgument', 'required', 'badRequest', 'forbidden', 'conditionNotMet', 'notFound', 'conflict', 'rateLimitExceeded', 'userProjectMissing', 'billingNotEnabled', 'invalidParameter')) { $safe.CloudReason = $reason }
    $message = [string]$body['error']['message']
    $location = [string](@($body['error']['errors'])[0]['location'])
    if ($reason -ceq 'required' -and $location -cin @('sourceBucket', 'sourceObject', 'destinationBucket', 'destinationObject', 'name', 'Content-Length')) {
      $safe.ErrorClass = 'required-' + $location
      return $safe
    }
    $safe.ErrorClass = switch -Regex ($message) {
      '(?i)sourceGeneration|source generation|generation.*invalid|invalid.*generation' { 'invalid-generation'; break }
      '(?i)invalid.*(argument|parameter)|required.*(argument|parameter)' { 'invalid-parameter'; break }
      '(?i)metadata|cache.?control|content.?type' { 'object-metadata'; break }
      '(?i)uniform.*bucket|legacy.*acl|predefined.*acl' { 'acl-policy'; break }
      '(?i)encryption|kms|customer.?supplied' { 'encryption'; break }
      '(?i)billing|user.?project' { 'billing-project'; break }
      '(?i)rewrite.*token|token.*rewrite' { 'rewrite-token'; break }
      default { 'unclassified' }
    }
  } catch { }
  return $safe
}
function Get-RecoveryOperation([string]$Method, [string]$Url) {
  $uri = [Uri]$Url
  if ($uri.AbsolutePath.Contains('/rewriteTo/')) { return 'object-rewrite' }
  if ($uri.Query.Contains('alt=media')) { return 'object-read' }
  if ($uri.AbsolutePath.EndsWith('/iam/testPermissions')) { return 'iam-test' }
  if ($uri.AbsolutePath.EndsWith('/iam')) { return $(if ($Method -ceq 'PUT') { 'iam-update' } else { 'iam-read' }) }
  if ($uri.AbsolutePath.EndsWith('/o')) { return 'object-list' }
  if ($Method -ceq 'POST') { return 'bucket-create' }
  return 'bucket-read'
}
function Get-RecoveryUtcDate($Value) {
  # PowerShell 7.5 ConvertFrom-Json can materialize ISO dates as DateTime.
  # Never roundtrip through a culture-dependent DateTime.ToString().
  if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) }
  if ($Value -is [DateTime]) {
    if ($Value.Kind -eq [DateTimeKind]::Unspecified) { Stop-Recovery 'resume-creation-date-invalid' }
    return $Value.ToUniversalTime().ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  }
  $created = [DateTimeOffset]::MinValue
  if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$' -or
      -not [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$created)) { Stop-Recovery 'resume-creation-date-invalid' }
  return $created.UtcDateTime.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
}
function Test-RecoveryBucket([string]$Bucket, [switch]$Destination) {
  $newBucket = $Bucket -cmatch '^kreatum-stg-(backup|restore)-20260911-[a-f0-9]{24}$'
  if ($Destination) { return $newBucket }
  return ($newBucket -or $Bucket -ceq 'kreatum-dinamic-staging.firebasestorage.app')
}
function Assert-RecoveryObject([string]$Name) {
  # Strict characters also prevent CEL escaping and URL path ambiguity. Unknown formats stop.
  if ($Name.Length -gt 800 -or $Name -cnotmatch '^organizations/[A-Za-z0-9_-]+/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+$' -or
      @($Name.Split('/') | Where-Object { $_ -in @('.', '..') }).Count) { Stop-Recovery 'invalid-object-scope' }
}
function Get-RecoveryInventory($Items) {
  if (@($Items).Count -lt 1 -or @($Items).Count -gt 200) { Stop-Recovery 'object-count-limit' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $result = [Collections.Generic.List[object]]::new(); $total = 0L
  foreach ($item in $Items) {
    $name = [string]$item['name']; Assert-RecoveryObject $name
    $size = 0L
    if (-not $seen.Add($name)) { Stop-Recovery 'duplicate-object' }
    if ([string]$item['generation'] -cnotmatch '^[1-9][0-9]{0,24}$' -or
        -not [long]::TryParse([string]$item['size'], [ref]$size) -or $size -lt 0 -or $size -gt 512MB) { Stop-Recovery 'invalid-object-metadata' }
    $total += $size
    if ($total -gt 512MB) { Stop-Recovery 'inventory-byte-limit' }
    $result.Add(@{ name = $name; generation = [string]$item['generation']; size = $size })
  }
  return ,$result.ToArray()
}
function New-RecoveryBucketBody([string]$Bucket, [string]$Location) {
  if (-not (Test-RecoveryBucket $Bucket -Destination) -or $Location.ToUpperInvariant() -notin @('EUROPE-SOUTHWEST1', 'EUROPE-WEST1', 'EU')) { Stop-Recovery 'invalid-destination-bucket' }
  return @{
    name = $Bucket; location = $Location; storageClass = 'STANDARD'
    iamConfiguration = @{ uniformBucketLevelAccess = @{ enabled = $true }; publicAccessPrevention = 'enforced' }
    lifecycle = @{ rule = @(@{ action = @{ type = 'Delete' }; condition = @{ age = 7 } }) }
    softDeletePolicy = @{ retentionDurationSeconds = '604800' }
    labels = @{ purpose = 'isolated-security-recovery'; temporary = 'true' }
  }
}
function Assert-RecoveryBucketPolicy($Metadata, [string]$ExpectedName, [string]$Location) {
  if ($Metadata['name'] -cne $ExpectedName -or $Metadata['location'].ToUpperInvariant() -cne $Location.ToUpperInvariant() -or
      $Metadata['iamConfiguration']['uniformBucketLevelAccess']['enabled'] -ne $true -or
      $Metadata['iamConfiguration']['publicAccessPrevention'] -cne 'enforced' -or
      [string]$Metadata['softDeletePolicy']['retentionDurationSeconds'] -cne '604800') { Stop-Recovery 'bucket-security-readback-failed' }
  $rules = @($Metadata['lifecycle']['rule'])
  if ($rules.Count -ne 1 -or $rules[0]['action']['type'] -cne 'Delete' -or $rules[0]['condition']['age'] -ne 7) { Stop-Recovery 'bucket-lifecycle-readback-failed' }
}
function New-RecoveryBinding([string]$Bucket, $Objects, [string]$Member, [string]$Title, [string]$Role, [DateTimeOffset]$Now) {
  if (-not (Test-RecoveryBucket $Bucket) -or $Member -cnotmatch '^user:[^\s:@]+@[^\s:@]+$' -or
      $Member.EndsWith('.gserviceaccount.com') -or $Title -cnotmatch '^recovery-[a-f0-9]{32}-(source|backup|restore)-(read|create)$' -or
      $Role -notin @('roles/storage.objectViewer', 'roles/storage.objectCreator')) { Stop-Recovery 'invalid-binding-scope' }
  if ($Role -eq 'roles/storage.objectCreator' -and -not (Test-RecoveryBucket $Bucket -Destination)) { Stop-Recovery 'source-write-forbidden' }
  $valid = Get-RecoveryInventory $Objects
  $resources = @($valid | ForEach-Object { '"projects/_/buckets/' + $Bucket + '/objects/' + $_.name + '"' })
  $expiry = $Now.ToUniversalTime().AddMinutes(55).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $expression = '(resource.name in [' + ($resources -join ',') + ']) && request.time < timestamp("' + $expiry + '")'
  if ([Text.Encoding]::UTF8.GetByteCount($expression) -gt 18000) { Stop-Recovery 'iam-expression-too-large' }
  return @{ role = $Role; members = @($Member); condition = @{ title = $Title; description = 'Temporary exact-object staging recovery; expires within one hour.'; expression = $expression } }
}
function Copy-RecoveryPolicy($Policy) {
  if (-not $Policy.Contains('bindings') -or [string]::IsNullOrWhiteSpace([string]$Policy['etag']) -or [int]$Policy['version'] -notin @(1, 3)) { Stop-Recovery 'invalid-iam-policy' }
  return ($Policy | ConvertTo-Json -Depth 100 -Compress | ConvertFrom-Json -AsHashtable)
}
function Update-RecoveryBinding($Policy, $Binding, [switch]$Remove) {
  $copy = Copy-RecoveryPolicy $Policy; $copy.version = 3
  $matches = @($copy.bindings | Where-Object { $_['condition'] -and $_['condition']['title'] -ceq $Binding.condition.title })
  if (-not $Remove) {
    if ($matches.Count) { Stop-Recovery 'binding-title-collision' }
    $copy.bindings = @($copy.bindings) + @($Binding)
  } else {
    if (-not $matches.Count) { return $null }
    if ($matches.Count -ne 1 -or $matches[0].role -cne $Binding.role -or @($matches[0].members).Count -ne 1 -or
        $matches[0].members[0] -cne $Binding.members[0] -or $matches[0].condition.expression -cne $Binding.condition.expression) { Stop-Recovery 'own-binding-modified' }
    $copy.bindings = @($copy.bindings | Where-Object { -not ($_['condition'] -and $_['condition']['title'] -ceq $Binding.condition.title) })
  }
  return $copy
}
function Assert-RecoveryRequest([string]$Method, [string]$Url, [string[]]$Buckets, $Body) {
  $uri = [Uri]$Url
  if ($uri.Scheme -cne 'https' -or $uri.Host -cne 'storage.googleapis.com' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Fragment) { Stop-Recovery 'request-outside-scope' }
  if ($Method -ceq 'POST' -and $uri.AbsolutePath -ceq '/storage/v1/b' -and $uri.Query -ceq '?project=kreatum-dinamic-staging') {
    if ($null -eq $Body -or $Body['name'] -cnotin $Buckets -or -not (Test-RecoveryBucket $Body['name'] -Destination)) { Stop-Recovery 'bucket-create-outside-scope' }
    return
  }
  $pathMatch = [regex]::Match($uri.AbsolutePath, '^/storage/v1/b/([^/]+)(.*)$')
  if (-not $pathMatch.Success -or $pathMatch.Groups[1].Value -cnotin $Buckets) { Stop-Recovery 'request-outside-scope' }
  $tail = $pathMatch.Groups[2].Value
  if ($Method -ceq 'GET' -and ($tail -eq '' -or $tail -eq '/iam')) { return }
  if ($Method -ceq 'GET' -and $tail -ceq '/iam/testPermissions' -and $uri.Query -cmatch '^\?permissions=storage\.objects\.(get|create)$') { return }
  if ($Method -ceq 'PUT' -and $tail -ceq '/iam') { return }
  if ($Method -ceq 'GET' -and $tail -ceq '/o' -and $uri.Query -match '(^\?|&)prefix=organizations%2F(&|$)') { return }
  if ($Method -ceq 'GET' -and $tail -ceq '/o' -and (Test-RecoveryBucket $pathMatch.Groups[1].Value -Destination) -and $uri.Query -ceq '?maxResults=1&fields=items(name),nextPageToken') { return }
  if ($Method -ceq 'GET' -and $tail -match '^/o/([^/]+)$') { Assert-RecoveryObject ([Uri]::UnescapeDataString($Matches[1])); return }
  $rewrite = [regex]::Match($tail, '^/o/([^/]+)/rewriteTo/b/([^/]+)/o/([^/]+)$')
  if ($Method -ceq 'POST' -and $rewrite.Success -and $rewrite.Groups[2].Value -cin $Buckets -and (Test-RecoveryBucket $rewrite.Groups[2].Value -Destination)) {
    $sourceName = [Uri]::UnescapeDataString($rewrite.Groups[1].Value)
    $destinationName = [Uri]::UnescapeDataString($rewrite.Groups[3].Value)
    Assert-RecoveryObject $sourceName; Assert-RecoveryObject $destinationName
    if ($sourceName -cne $destinationName -or $Body['name'] -cne $destinationName -or
        $uri.Query -notmatch '(^\?|&)sourceGeneration=[1-9][0-9]*(&|$)' -or $uri.Query -notmatch '(^\?|&)ifGenerationMatch=0(&|$)') { Stop-Recovery 'rewrite-precondition-required' }
    return
  }
  Stop-Recovery 'request-outside-scope'
}
function Invoke-RecoveryRequest($Client, [string]$Method, [string]$Url, [string[]]$Buckets, $Body = $null, [long]$MaximumBytes = 2MB, [switch]$Binary) {
  Assert-RecoveryRequest $Method $Url $Buckets $Body
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Url)
  $response = $null; $stream = $null; $memory = $null
  try {
    if ($null -ne $Body) { $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 100 -Compress), [Text.Encoding]::UTF8, 'application/json') }
    $response = $Client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      $errorStream = $null; $errorMemory = $null; $errorBytes = $null
      $safeError = @{ CloudReason = 'unclassified'; ErrorClass = 'unclassified' }
      try {
        $errorStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $errorMemory = [IO.MemoryStream]::new()
        $errorBuffer = [byte[]]::new(4096)
        while (($errorCount = $errorStream.Read($errorBuffer, 0, $errorBuffer.Length)) -gt 0) {
          if ($errorMemory.Length + $errorCount -gt 32768) { break }
          $errorMemory.Write($errorBuffer, 0, $errorCount)
        }
        $errorBytes = $errorMemory.ToArray(); $safeError = Get-RecoveryCloudError $errorBytes
      } catch { } finally {
        if ($errorMemory) { $errorMemory.Dispose() }; if ($errorStream) { $errorStream.Dispose() }
        if ($null -ne $errorBytes) { [Array]::Clear($errorBytes, 0, $errorBytes.Length) }
      }
      $rejected = [InvalidOperationException]::new('Staging recovery request rejected; sensitive details suppressed.')
      $rejected.Data['SafeCode'] = 'cloud-http-rejected'; $rejected.Data['HttpStatus'] = [int]$response.StatusCode
      $rejected.Data['Operation'] = Get-RecoveryOperation $Method $Url
      $rejected.Data['CloudReason'] = $safeError.CloudReason; $rejected.Data['ErrorClass'] = $safeError.ErrorClass
      throw $rejected
    }
    if ($response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $MaximumBytes) { Stop-Recovery 'response-too-large' }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $memory = [IO.MemoryStream]::new(); $buffer = [byte[]]::new(65536)
    while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if ($memory.Length + $count -gt $MaximumBytes) { Stop-Recovery 'response-too-large' }
      $memory.Write($buffer, 0, $count)
    }
    $bytes = $memory.ToArray()
    if ($Binary) { return ,$bytes }
    return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable -Depth 100)
  } finally {
    if ($memory) { $memory.Dispose() }; if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }; $request.Dispose()
  }
}
function Invoke-RecoveryGcloud([string[]]$Arguments) {
  $result = @(& gcloud @Arguments --quiet 2>$null)
  if ($LASTEXITCODE -ne 0) { Stop-Recovery 'configured-credential-failed' }
  return ($result -join "`n").Trim()
}
function Get-RecoveryHash([byte[]]$Bytes, [long]$ExpectedSize) {
  if ($Bytes.LongLength -ne $ExpectedSize) { Stop-Recovery 'object-size-mismatch' }
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
}
function Get-RecoveryContentType([string]$Name) {
  return $(switch ([IO.Path]::GetExtension($Name).ToLowerInvariant()) {
    '.pdf' { 'application/pdf' }
    '.pptx' { 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
    '.json' { 'application/json' }
    default { 'application/octet-stream' }
  })
}
function New-RecoveryCopyArguments([string[]]$Buckets, [string]$Source, [string]$Destination, $Object) {
  if ($Source -cnotin $Buckets -or $Destination -cnotin $Buckets -or -not (Test-RecoveryBucket $Source) -or
      -not (Test-RecoveryBucket $Destination -Destination)) { Stop-Recovery 'copy-outside-scope' }
  $allowedDirection = ($Source -ceq 'kreatum-dinamic-staging.firebasestorage.app' -and $Destination.StartsWith('kreatum-stg-backup-20260911-')) -or
    ($Source.StartsWith('kreatum-stg-backup-20260911-') -and $Destination.StartsWith('kreatum-stg-restore-20260911-'))
  if (-not $allowedDirection) { Stop-Recovery 'copy-direction-forbidden' }
  $checkedObject = (Get-RecoveryInventory @($Object))[0]
  return ,@('storage', 'cp', ('gs://' + $Source + '/' + $checkedObject.name + '#' + $checkedObject.generation),
    ('gs://' + $Destination + '/' + $checkedObject.name), '--if-generation-match=0', '--clear-custom-metadata',
    '--cache-control=private,no-store', ('--content-type=' + (Get-RecoveryContentType $checkedObject.name)),
    '--project=kreatum-dinamic-staging', '--quiet')
}
function Invoke-RecoveryStorageCopy([string[]]$Arguments) {
  # Use the same configured gcloud user as all REST reads/IAM. Capture ALL CLI output.
  # No alternate identity, no local daisy-chain copy, no wildcard or recursive operation.
  $PSNativeCommandUseErrorActionPreference = $false
  $captured = @(& gcloud @Arguments 2>&1)
  $copyExitCode = $LASTEXITCODE
  $safeCode = 'cloud-copy-command-failed'
  if ($copyExitCode -ne 0) {
    $privateText = ($captured | ForEach-Object { [string]$_ }) -join "`n"
    if ($privateText -match '(?i)\b403\b|PermissionDenied|permission.?denied|does not have .*permission|access.?denied') { $safeCode = 'cloud-copy-permission-denied' }
    elseif ($privateText -match '(?i)\b400\b|BadRequest|bad request') { $safeCode = 'cloud-copy-bad-request' }
    $privateText = $null
  }
  $captured = $null
  if ($copyExitCode -ne 0) { Stop-Recovery $safeCode }
}
function Invoke-RecoveryCopy($Client, [string[]]$Buckets, [string]$Source, [string]$Destination, $Object) {
  $arguments = New-RecoveryCopyArguments $Buckets $Source $Destination $Object
  Invoke-RecoveryStorageCopy $arguments
  $objectUrl = 'https://storage.googleapis.com/storage/v1/b/' + $Destination + '/o/' + [Uri]::EscapeDataString($Object.name)
  $resource = Invoke-RecoveryRequest $Client 'GET' $objectUrl $Buckets
  if ($resource['bucket'] -cne $Destination -or $resource['name'] -cne $Object.name -or [long]$resource['size'] -ne $Object.size -or
      [string]$resource['generation'] -cnotmatch '^[1-9][0-9]*$' -or ($resource['metadata'] -and $resource['metadata'].Count) -or
      ([string]$resource['cacheControl']).Replace(' ', '') -cne 'private,no-store' -or
      $resource['contentType'] -cne (Get-RecoveryContentType $Object.name)) { Stop-Recovery 'copy-readback-invalid' }
  return @{ name = $Object.name; size = $Object.size; generation = [string]$resource['generation'] }
}

$runId = 'recovery-' + [Guid]::NewGuid().ToString('N')
$source = 'kreatum-dinamic-staging.firebasestorage.app'
$backup = 'kreatum-stg-backup-20260911-' + [Guid]::NewGuid().ToString('N').Substring(0, 24)
$restore = 'kreatum-stg-restore-20260911-' + [Guid]::NewGuid().ToString('N').Substring(0, 24)
if ($Resume) {
  # Only the exact two buckets created by this failed, user-authorized run may be resumed.
  $runId = 'recovery-ee710d63a63a47c6b0bed6f7e09efc76'
  $backup = 'kreatum-stg-backup-20260911-c08283a8481a41609092de7d'
  $restore = 'kreatum-stg-restore-20260911-a9ebbfdae3ac496cb3ff4353'
}
$buckets = @($source, $backup, $restore)
$client = $null; $handler = $null; $failure = $null; $cleanupFailures = @(); $grants = [Collections.Generic.List[object]]::new()
$stage = 'configuration'; $checked = 0
$evidence = @{ runId = $runId; mode = $(if ($Resume) { 'resume' } elseif ($Execute) { 'execute' } else { 'check' }); scope = 'live-organizations-objects-only'; objectCount = 0; bytes = 0; createdBuckets = @(); resumedBuckets = @(); verifiedObjects = 0; cleanup = 'not-needed'; applicationRecovery = 'not-tested' }
try {
  foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Value -and $entry.Name -match 'EMULATOR|IMPERSONATE|CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE|CLOUDSDK_AUTH_ACCESS_TOKEN') { Stop-Recovery 'alternate-credentials-forbidden' }
  }
  $impersonation = Invoke-RecoveryGcloud @('config', 'get-value', 'auth/impersonate_service_account')
  if ($impersonation -and $impersonation -ne '(unset)') { Stop-Recovery 'impersonation-forbidden' }
  $account = Invoke-RecoveryGcloud @('config', 'get-value', 'account')
  if ($account -notmatch '^[^\s:@]+@[^\s:@]+$' -or $account.EndsWith('.gserviceaccount.com')) { Stop-Recovery 'configured-user-required' }
  $token = Invoke-RecoveryGcloud @('auth', 'print-access-token', '--account', $account)
  if (-not $token) { Stop-Recovery 'configured-credential-failed' }
  $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromSeconds(60)
  $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
  $null = $client.DefaultRequestHeaders.TryAddWithoutValidation('x-goog-user-project', 'kreatum-dinamic-staging'); $token = $null
  $stage = 'inventory'
  $sourceMetadata = Invoke-RecoveryRequest $client 'GET' ('https://storage.googleapis.com/storage/v1/b/' + $source + '?fields=name,location,iamConfiguration,projectNumber') $buckets
  $location = [string]$sourceMetadata['location']; $null = New-RecoveryBucketBody $backup $location
  if ($sourceMetadata['iamConfiguration']['uniformBucketLevelAccess']['enabled'] -ne $true) { Stop-Recovery 'source-ubla-required' }
  $pageToken = $null; $items = [Collections.Generic.List[object]]::new()
  do {
    $listUrl = 'https://storage.googleapis.com/storage/v1/b/' + $source + '/o?prefix=organizations%2F&maxResults=201&fields=items(name,size,generation),nextPageToken'
    if ($pageToken) { $listUrl += '&pageToken=' + [Uri]::EscapeDataString($pageToken) }
    $page = Invoke-RecoveryRequest $client 'GET' $listUrl $buckets
    foreach ($item in @($page['items'])) { if ($null -ne $item) { $items.Add($item) } }
    if ($items.Count -gt 200) { Stop-Recovery 'object-count-limit' }
    $pageToken = [string]$page['nextPageToken']
    if ($pageToken -and $items.Count -eq 0) { Stop-Recovery 'empty-inventory-page' }
  } while ($pageToken)
  $objects = Get-RecoveryInventory $items.ToArray()
  $evidence.objectCount = $objects.Count; $evidence.bytes = [long](($objects | Measure-Object size -Sum).Sum); $evidence.location = $location
  # Construct every binding before any write; failure cannot leave partial bucket creation.
  $plans = @(
    @{ bucket = $source; binding = (New-RecoveryBinding $source $objects ('user:' + $account) ($runId + '-source-read') 'roles/storage.objectViewer' ([DateTimeOffset]::UtcNow)) }
    @{ bucket = $backup; binding = (New-RecoveryBinding $backup $objects ('user:' + $account) ($runId + '-backup-read') 'roles/storage.objectViewer' ([DateTimeOffset]::UtcNow)) }
    @{ bucket = $backup; binding = (New-RecoveryBinding $backup $objects ('user:' + $account) ($runId + '-backup-create') 'roles/storage.objectCreator' ([DateTimeOffset]::UtcNow)) }
    @{ bucket = $restore; binding = (New-RecoveryBinding $restore $objects ('user:' + $account) ($runId + '-restore-read') 'roles/storage.objectViewer' ([DateTimeOffset]::UtcNow)) }
    @{ bucket = $restore; binding = (New-RecoveryBinding $restore $objects ('user:' + $account) ($runId + '-restore-create') 'roles/storage.objectCreator' ([DateTimeOffset]::UtcNow)) }
  )
  $sourcePolicy = Invoke-RecoveryRequest $client 'GET' ('https://storage.googleapis.com/storage/v1/b/' + $source + '/iam?optionsRequestedPolicyVersion=3') $buckets
  $null = Copy-RecoveryPolicy $sourcePolicy
  if ($Execute -or $Resume) {
    $stage = 'create-isolated-buckets'
    foreach ($destination in @($backup, $restore)) {
      # Bucket insert has no overwrite semantics; collision/403 stops. Existing bucket is never adopted.
      if (-not $Resume) {
        $null = Invoke-RecoveryRequest $client 'POST' 'https://storage.googleapis.com/storage/v1/b?project=kreatum-dinamic-staging' $buckets (New-RecoveryBucketBody $destination $location)
        $evidence.createdBuckets += $destination
      }
      $readback = Invoke-RecoveryRequest $client 'GET' ('https://storage.googleapis.com/storage/v1/b/' + $destination) $buckets
      Assert-RecoveryBucketPolicy $readback $destination $location
      if ($Resume) {
        if ([string]$sourceMetadata['projectNumber'] -cnotmatch '^[0-9]+$' -or [string]$readback['projectNumber'] -cne [string]$sourceMetadata['projectNumber']) { Stop-Recovery 'resume-project-mismatch' }
        if ($readback['labels']['purpose'] -cne 'isolated-security-recovery' -or $readback['labels']['temporary'] -cne 'true') { Stop-Recovery 'resume-labels-mismatch' }
        if ((Get-RecoveryUtcDate $readback['timeCreated']) -cne '2026-09-11') { Stop-Recovery 'resume-creation-date-mismatch' }
        $empty = Invoke-RecoveryRequest $client 'GET' ('https://storage.googleapis.com/storage/v1/b/' + $destination + '/o?maxResults=1&fields=items(name),nextPageToken') $buckets
        if (@($empty['items'] | Where-Object { $null -ne $_ }).Count -or $empty['nextPageToken']) { Stop-Recovery 'resume-bucket-not-empty' }
        $evidence.resumedBuckets += $destination
      }
      $policy = Invoke-RecoveryRequest $client 'GET' ('https://storage.googleapis.com/storage/v1/b/' + $destination + '/iam?optionsRequestedPolicyVersion=3') $buckets
      $null = Copy-RecoveryPolicy $policy
    }
    $stage = 'temporary-exact-grants'
    foreach ($plan in $plans) {
      $iamUrl = 'https://storage.googleapis.com/storage/v1/b/' + $plan.bucket + '/iam'
      $policy = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') $buckets
      $permission = $(if ($plan.binding.role -ceq 'roles/storage.objectCreator') { 'storage.objects.create' } else { 'storage.objects.get' })
      $held = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '/testPermissions?permissions=' + $permission) $buckets
      # Avoid redundant grants. A later denied object request stops, never escalates automatically.
      if ($permission -cin @($held['permissions'])) { continue }
      $updated = Update-RecoveryBinding $policy $plan.binding
      $grants.Add($plan) # Include uncertain PUT outcomes in finally cleanup.
      $null = Invoke-RecoveryRequest $client 'PUT' $iamUrl $buckets $updated
      $readback = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') $buckets
      if ($null -eq (Update-RecoveryBinding $readback $plan.binding -Remove)) { Stop-Recovery 'grant-readback-missing' }
    }
    $stage = 'iam-propagation'
    @{ stage = $stage; seconds = 60 } | ConvertTo-Json -Compress
    if ($grants.Count) { Start-Sleep -Seconds 60 }
    $hashes = [Collections.Generic.List[string]]::new(); $stage = 'backup-restore-integrity'
    foreach ($object in $objects) {
      $originalHash = $null
      foreach ($pair in @(@{ bucket = $source; item = $object }, @{ bucket = $backup; item = (Invoke-RecoveryCopy $client $buckets $source $backup $object) })) {
        $bytes = $null
        try {
          $url = 'https://storage.googleapis.com/storage/v1/b/' + $pair.bucket + '/o/' + [Uri]::EscapeDataString($pair.item.name) + '?alt=media&generation=' + $pair.item.generation
          $bytes = Invoke-RecoveryRequest $client 'GET' $url $buckets -MaximumBytes ([Math]::Max(1L, $object.size)) -Binary
          $hash = Get-RecoveryHash $bytes $object.size
          if ($null -eq $originalHash) { $originalHash = $hash } elseif ($hash -cne $originalHash) { Stop-Recovery 'backup-hash-mismatch' }
          if ($pair.bucket -ceq $backup) { $backupObject = $pair.item }
        } finally { if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }; $bytes = $null }
      }
      $restoredObject = Invoke-RecoveryCopy $client $buckets $backup $restore $backupObject
      $bytes = $null
      try {
        $url = 'https://storage.googleapis.com/storage/v1/b/' + $restore + '/o/' + [Uri]::EscapeDataString($restoredObject.name) + '?alt=media&generation=' + $restoredObject.generation
        $bytes = Invoke-RecoveryRequest $client 'GET' $url $buckets -MaximumBytes ([Math]::Max(1L, $object.size)) -Binary
        if ((Get-RecoveryHash $bytes $object.size) -cne $originalHash) { Stop-Recovery 'restore-hash-mismatch' }
        $hashes.Add($originalHash); $checked++
      } finally { if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }; $bytes = $null }
    }
    $aggregateBytes = [Text.Encoding]::UTF8.GetBytes((@($hashes | Sort-Object) -join "`n"))
    $evidence.contentHashAggregate = Get-RecoveryHash $aggregateBytes $aggregateBytes.LongLength
    $evidence.hashChecks = 'original-backup-restore-all-match'
  }
} catch { $failure = Get-RecoveryFailure $_; $failure.stage = $stage }
finally {
  $cleanupGrants = $grants.ToArray(); [Array]::Reverse($cleanupGrants)
  foreach ($grant in $cleanupGrants) {
    try {
      $iamUrl = 'https://storage.googleapis.com/storage/v1/b/' + $grant.bucket + '/iam'
      $current = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') $buckets
      $without = Update-RecoveryBinding $current $grant.binding -Remove
      if ($null -ne $without) { $null = Invoke-RecoveryRequest $client 'PUT' $iamUrl $buckets $without }
      $readback = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') $buckets
      if ($null -ne (Update-RecoveryBinding $readback $grant.binding -Remove)) { Stop-Recovery 'cleanup-readback-failed' }
    } catch { $cleanupFailures += Get-RecoveryFailure $_ }
  }
  if ($grants.Count) { $evidence.cleanup = $(if ($cleanupFailures.Count) { 'failed-review-required-grants-expire-within-one-hour' } else { 'all-own-grants-absent-verified' }) }
  if ($client) { $client.Dispose() }; if ($handler) { $handler.Dispose() }
  $token = $null; $account = $null; $objects = $null; $items = $null; $policy = $null; $sourcePolicy = $null; $plans = $null
}
$evidence.verifiedObjects = $checked
if ($failure -or $cleanupFailures.Count) {
  $evidence.status = 'failed'
  if ($failure) { $evidence.failure = $failure }
  if ($cleanupFailures.Count) { $evidence.cleanupFailures = $cleanupFailures }
  $evidence | ConvertTo-Json -Depth 6 -Compress
  exit 1
}
$evidence.status = $(if (($Execute -or $Resume) -and $checked -eq $evidence.objectCount) { 'object-recovery-verified' } elseif (-not $Execute -and -not $Resume) { 'check-passed-no-mutation' } else { 'incomplete' })
$evidence | ConvertTo-Json -Depth 6 -Compress
if ($evidence.status -eq 'incomplete') { exit 1 }
