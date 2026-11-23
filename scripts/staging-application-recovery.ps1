#requires -Version 7.2
<#
Read-only/local guard check by default. Execute grants only exact-object read access
to the already restored staging bucket, launches the local application probe, and
removes its own grant in finally with fresh etag/readback. Does not start services.
The operator starts empty demo Auth/Firestore/Storage emulators first, and starts
demo Functions + local preview only after the emitted seeded event.
Never prints credentials, document contents, object paths, or child stderr.
#>
[CmdletBinding(DefaultParameterSetName = 'Check')]
param(
  [Parameter(ParameterSetName = 'Check')][switch]$Check,
  [Parameter(Mandatory, ParameterSetName = 'Execute')][switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Load declarations only. No cloud entry point from the helper is executed.
$helperTokens = $null; $helperErrors = $null
$helperAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'staging-storage-recovery.ps1'), [ref]$helperTokens, [ref]$helperErrors)
if ($helperErrors.Count) { throw 'Recovery helper parsing failed.' }
foreach ($definition in $helperAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($definition.Extent.Text))
}

function Assert-PrivateRecoveryDirectory([string]$Directory, [string]$Workspace) {
  $expected = [IO.Path]::GetFullPath((Join-Path $Workspace 'tmp/recovery-runtime-fb7310d73e06496b93352d19118a6d65'))
  if ([IO.Path]::GetFullPath($Directory) -cne $expected) { Stop-Recovery 'private-directory-scope-mismatch' }
  $folder = Get-Item -LiteralPath $Directory -Force
  if (-not $folder.PSIsContainer -or ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Stop-Recovery 'private-directory-link-forbidden' }
  $parent = Get-Item -LiteralPath (Split-Path -Parent $Directory) -Force
  if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Recovery 'private-directory-link-forbidden' }
  $acl = Get-Acl -LiteralPath $Directory
  if (-not $acl.AreAccessRulesProtected) { Stop-Recovery 'private-directory-inherits-access' }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, 'S-1-5-18')
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if (-not $rules.Count) { Stop-Recovery 'private-directory-acl-empty' }
  $fullControl = @{}
  foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -cnotin $allowedSids -or $rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { Stop-Recovery 'private-directory-acl-too-broad' }
    if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) { $fullControl[$rule.IdentityReference.Value] = $true }
  }
  if (-not $fullControl[$currentSid] -or -not $fullControl['S-1-5-18']) { Stop-Recovery 'private-directory-full-control-required' }
  $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -cnotin $allowedSids) { Stop-Recovery 'private-directory-owner-mismatch' }
}
function Convert-SafeProbeEvent([string]$Line) {
  try { $parsed = $Line | ConvertFrom-Json -AsHashtable -Depth 8 } catch { Stop-Recovery 'child-output-not-json' }
  if ($parsed['event'] -cnotin @('local-guards-verified', 'seeded', 'verified', 'blocked')) { Stop-Recovery 'child-event-not-allowed' }
  $safe = @{ event = $parsed['event'] }
  foreach ($key in @('cloudRequests', 'localWrites', 'restoredDocuments', 'restoredArtifacts', 'syntheticLocalOwners', 'uiDownloadsVerified', 'uiWorkshopsVerified', 'cloudWrites')) {
    if ($parsed.Contains($key)) {
      if ($parsed[$key] -isnot [long] -and $parsed[$key] -isnot [int]) { Stop-Recovery 'child-count-invalid' }
      if ($parsed[$key] -lt 0 -or $parsed[$key] -gt 10000) { Stop-Recovery 'child-count-invalid' }
      $safe[$key] = $parsed[$key]
    }
  }
  foreach ($key in @('privateTemporaryDirectoryVerified', 'startFunctionsAndLocalPreviewNow', 'productionAccess', 'privateTemporaryCleanupRequired')) {
    if ($parsed.Contains($key)) { if ($parsed[$key] -isnot [bool]) { Stop-Recovery 'child-boolean-invalid' }; $safe[$key] = $parsed[$key] }
  }
  if ($parsed['code']) { if ($parsed['code'] -cnotmatch '^[a-z0-9-]{3,80}$') { Stop-Recovery 'child-code-invalid' }; $safe.code = $parsed['code'] }
  if ($parsed['documentDigest']) { if ($parsed['documentDigest'] -cnotmatch '^[a-f0-9]{64}$') { Stop-Recovery 'child-digest-invalid' }; $safe.documentDigest = $parsed['documentDigest'] }
  # Limitations use fixed wrapper wording, never propagate arbitrary child strings.
  if ($parsed['event'] -ceq 'verified') { $safe.scope = 'local-emulator-application-not-full-cloud-dr'; $safe.cloudAuthRestored = $false }
  return ($safe | ConvertTo-Json -Depth 4 -Compress)
}

$workspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$privateTemp = Join-Path $workspace 'tmp/recovery-runtime-fb7310d73e06496b93352d19118a6d65'
$bucket = 'kreatum-stg-restore-20260911-a9ebbfdae3ac496cb3ff4353'
$runId = 'recovery-' + [Guid]::NewGuid().ToString('N')
$client = $null; $handler = $null; $binding = $null; $grantAttempted = $false; $failure = $null; $cleanupFailure = $null; $process = $null
$stage = 'private-directory-check'; $cleanup = 'not-needed'; $childVerified = $false
$evidence = @{ runId = $runId; mode = $(if ($Execute) { 'execute' } else { 'check' }); restoreBucket = $bucket; objectCount = 0; bytes = 0; productionAccess = $false }
try {
  Assert-PrivateRecoveryDirectory $privateTemp $workspace
  if ($Execute) {
    $stage = 'configured-identity'
    foreach ($key in @('CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT', 'CLOUDSDK_AUTH_LOGIN_CONFIG_FILE')) {
      if ([Environment]::GetEnvironmentVariable($key)) { Stop-Recovery 'alternate-credentials-forbidden' }
    }
    $impersonation = Invoke-RecoveryGcloud @('config', 'get-value', 'auth/impersonate_service_account')
    if ($impersonation -and $impersonation -notin @('(unset)', 'None')) { Stop-Recovery 'impersonation-forbidden' }
    $account = Invoke-RecoveryGcloud @('config', 'get-value', 'account')
    if ($account -notmatch '^[^\s:@]+@[^\s:@]+$' -or $account.EndsWith('.gserviceaccount.com')) { Stop-Recovery 'configured-user-required' }
    $token = Invoke-RecoveryGcloud @('auth', 'print-access-token', '--account', $account)
    if (-not $token) { Stop-Recovery 'configured-credential-failed' }
    $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromSeconds(60)
    $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
    $null = $client.DefaultRequestHeaders.TryAddWithoutValidation('x-goog-user-project', 'kreatum-dinamic-staging'); $token = $null
    $base = 'https://storage.googleapis.com/storage/v1/b/' + $bucket
    $stage = 'restored-bucket-check'
    $metadata = Invoke-RecoveryRequest $client 'GET' $base @($bucket)
    Assert-RecoveryBucketPolicy $metadata $bucket 'EUROPE-SOUTHWEST1'
    if ([string]$metadata['projectNumber'] -cne '829452780690' -or $metadata['labels']['purpose'] -cne 'isolated-security-recovery' -or (Get-RecoveryUtcDate $metadata['timeCreated']) -cne '2026-09-11') { Stop-Recovery 'restored-bucket-identity-mismatch' }
    $page = Invoke-RecoveryRequest $client 'GET' ($base + '/o?prefix=organizations%2F&maxResults=201&fields=items(name,size,generation),nextPageToken') @($bucket)
    if ($page['nextPageToken']) { Stop-Recovery 'restored-inventory-incomplete' }
    $objects = Get-RecoveryInventory @($page['items'])
    if ($objects.Count -ne 9) { Stop-Recovery 'restored-object-count-mismatch' }
    $evidence.objectCount = $objects.Count; $evidence.bytes = [long](($objects | Measure-Object size -Sum).Sum)
    $iamUrl = $base + '/iam'
    $policy = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') @($bucket)
    $null = Copy-RecoveryPolicy $policy
    $held = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '/testPermissions?permissions=storage.objects.get') @($bucket)
    if ('storage.objects.get' -cnotin @($held['permissions'])) {
      $binding = New-RecoveryBinding $bucket $objects ('user:' + $account) ($runId + '-restore-read') 'roles/storage.objectViewer' ([DateTimeOffset]::UtcNow)
      $updated = Update-RecoveryBinding $policy $binding
      $stage = 'temporary-exact-read-grant'; $grantAttempted = $true
      $null = Invoke-RecoveryRequest $client 'PUT' $iamUrl @($bucket) $updated
      $readback = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') @($bucket)
      if ($null -eq (Update-RecoveryBinding $readback $binding -Remove)) { Stop-Recovery 'grant-readback-missing' }
      @{ event = 'read-grant-propagation'; seconds = 60 } | ConvertTo-Json -Compress
      Start-Sleep -Seconds 60
    }
  }
  $stage = 'local-application-probe'
  # Environment is private to the child. The wrapper's configured cloud identity stays unchanged.
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $start.WorkingDirectory = $workspace; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.ArgumentList.Add((Join-Path $PSScriptRoot 'staging-application-recovery.mjs'))
  if (-not $Execute) { $start.ArgumentList.Add('--check') }
  $start.ArgumentList.Add('--restore-bucket'); $start.ArgumentList.Add($bucket)
  $childEnvironment = @{
    TMP = $privateTemp; TEMP = $privateTemp; KREATUM_RECOVERY_PRIVATE_TEMP = $privateTemp; KREATUM_RECOVERY_PRIVATE_TEMP_VERIFIED = 'true'
    GCLOUD_PROJECT = 'demo-kreatum'; GOOGLE_CLOUD_PROJECT = 'demo-kreatum'
    FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'
  }
  foreach ($key in $childEnvironment.Keys) { $start.Environment[$key] = $childEnvironment[$key] }
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
  $null = $process.Start(); $stderrTask = $process.StandardError.ReadToEndAsync()
  while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
    $safeLine = Convert-SafeProbeEvent $line
    $safeEvent = $safeLine | ConvertFrom-Json -AsHashtable
    if ($safeEvent.event -ceq 'verified' -or (-not $Execute -and $safeEvent.event -ceq 'local-guards-verified')) { $childVerified = $true }
    Write-Output $safeLine
  }
  $process.WaitForExit(); $null = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0 -or -not $childVerified) { Stop-Recovery 'local-application-probe-incomplete' }
} catch { $failure = Get-RecoveryFailure $_; $failure.stage = $stage }
finally {
  if ($process) {
    try { if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() } } catch { }
    $process.Dispose()
  }
  if ($grantAttempted -and $client -and $binding) {
    try {
      $current = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') @($bucket)
      $without = Update-RecoveryBinding $current $binding -Remove
      if ($null -ne $without) { $null = Invoke-RecoveryRequest $client 'PUT' $iamUrl @($bucket) $without }
      $readback = Invoke-RecoveryRequest $client 'GET' ($iamUrl + '?optionsRequestedPolicyVersion=3') @($bucket)
      if ($null -ne (Update-RecoveryBinding $readback $binding -Remove)) { Stop-Recovery 'cleanup-readback-failed' }
      $cleanup = 'own-grant-absent-verified'
    } catch { $cleanupFailure = Get-RecoveryFailure $_; $cleanup = 'failed-review-required-grant-expires-within-one-hour' }
  }
  if ($client) { $client.Dispose() }; if ($handler) { $handler.Dispose() }
  $token = $null; $account = $null; $objects = $null; $policy = $null; $binding = $null
}
$evidence.cleanup = $cleanup; $evidence.privateTemporaryCleanupRequired = [bool]$Execute
if ($failure -or $cleanupFailure) {
  $evidence.status = 'failed'; if ($failure) { $evidence.failure = $failure }; if ($cleanupFailure) { $evidence.cleanupFailure = $cleanupFailure }
  $evidence | ConvertTo-Json -Depth 6 -Compress
  exit 1
}
$evidence.status = $(if ($Execute) { 'local-application-recovery-verified' } else { 'local-guards-verified-no-cloud' })
$evidence | ConvertTo-Json -Depth 6 -Compress
