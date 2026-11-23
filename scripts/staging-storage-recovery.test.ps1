#requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Function declarations only: never execute the cloud entry point.
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'staging-storage-recovery.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Script parsing failed.' }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { . ([scriptblock]::Create($function.Extent.Text)) }
$passed = 0
function Assert-Local([bool]$Value) { if (-not $Value) { throw 'Local assertion failed.' }; $script:passed++ }
function Assert-Rejected([scriptblock]$Action) {
  $rejected = $false
  try { $null = & $Action } catch { $rejected = $true }
  Assert-Local $rejected
}
foreach ($date in @('2026-09-11T21:11:51.426Z', '2026-09-11T21:11:52.315Z')) {
  Assert-Local ((Get-RecoveryUtcDate $date) -ceq '2026-09-11')
  $asDateTime = [DateTime]::Parse($date, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  Assert-Local ((Get-RecoveryUtcDate $asDateTime) -ceq '2026-09-11')
  Assert-Local ((Get-RecoveryUtcDate ([DateTimeOffset]::Parse($date))) -ceq '2026-09-11')
  $jsonDate = ('{"timeCreated":"' + $date + '"}') | ConvertFrom-Json -AsHashtable
  Assert-Local ((Get-RecoveryUtcDate $jsonDate.timeCreated) -ceq '2026-09-11')
}
Assert-Rejected { Get-RecoveryUtcDate '09/11/2026 21:11:51' }
Assert-Rejected { Get-RecoveryUtcDate ([DateTime]::new(2026, 9, 11)) }
Assert-Local ((Get-RecoveryUtcDate '2026-11-09T21:11:51Z') -cne '2026-09-11')
$source = 'kreatum-dinamic-staging.firebasestorage.app'
$backup = 'kreatum-stg-backup-20260911-' + ('a' * 24)
$restore = 'kreatum-stg-restore-20260911-' + ('b' * 24)
$buckets = @($source, $backup, $restore)
$objects = @(@{ name = 'organizations/synthetic/workshops/test/reports/report.pdf'; generation = '123456'; size = '3' })
$inventory = Get-RecoveryInventory $objects
Assert-Local ($inventory.Count -eq 1 -and $inventory[0].size -eq 3)
Assert-Local (Test-RecoveryBucket $backup -Destination)
Assert-Local (-not (Test-RecoveryBucket $source -Destination))
Assert-Local (-not (Test-RecoveryBucket 'kreatum-dinamic.firebasestorage.app'))
Assert-Rejected { Get-RecoveryInventory @() }
Assert-Rejected { Get-RecoveryInventory (@($objects[0]) * 201) }
Assert-Rejected { Get-RecoveryInventory @($objects[0], $objects[0]) }
foreach ($name in @('private/file.pdf', 'organizations/a/../b', 'organizations/a/./b', 'organizations/a/quote".pdf', ('organizations/a/line' + "`n" + '.pdf'))) { Assert-Rejected { Assert-RecoveryObject $name } }
foreach ($size in @('-1', 'NaN', '536870913')) { Assert-Rejected { Get-RecoveryInventory @(@{ name = $objects[0].name; generation = '1'; size = $size }) } }
Assert-Rejected { Get-RecoveryInventory @(@{ name = 'organizations/a/a'; generation = '1'; size = '536870912' }, @{ name = 'organizations/a/b'; generation = '2'; size = '1' }) }
foreach ($gen in @('0', '-1', '1&alt=media', '', 'abc')) { Assert-Rejected { Get-RecoveryInventory @(@{ name = $objects[0].name; generation = $gen; size = '3' }) } }
foreach ($location in @('EUROPE-SOUTHWEST1', 'europe-west1', 'EU')) {
  $body = New-RecoveryBucketBody $backup $location
  Assert-Local ($body.iamConfiguration.uniformBucketLevelAccess.enabled -and $body.iamConfiguration.publicAccessPrevention -ceq 'enforced')
  Assert-Local ($body.softDeletePolicy.retentionDurationSeconds -eq '604800' -and $body.lifecycle.rule[0].condition.age -eq 7)
  Assert-RecoveryBucketPolicy $body $backup $location
}
Assert-Rejected { New-RecoveryBucketBody $source 'EU' }
Assert-Rejected { New-RecoveryBucketBody $backup 'US' }
$bad = New-RecoveryBucketBody $backup 'EU'; $bad.iamConfiguration.publicAccessPrevention = 'inherited'
Assert-Rejected { Assert-RecoveryBucketPolicy $bad $backup 'EU' }
$title = 'recovery-' + ('c' * 32) + '-source-read'
$binding = New-RecoveryBinding $source $objects 'user:synthetic@example.invalid' $title 'roles/storage.objectViewer' ([DateTimeOffset]::Parse('2026-09-11T20:00:00Z'))
Assert-Local ($binding.condition.expression.Contains('timestamp("2026-09-11T20:55:00Z")'))
Assert-Local ($binding.condition.expression.Contains('projects/_/buckets/' + $source + '/objects/' + $objects[0].name))
Assert-Local (-not $binding.condition.expression.Contains('startsWith'))
Assert-Rejected { New-RecoveryBinding $source $objects 'user:synthetic@example.invalid' $title 'roles/storage.objectCreator' ([DateTimeOffset]::UtcNow) }
Assert-Rejected { New-RecoveryBinding $source $objects 'serviceAccount:synthetic@example.invalid' $title 'roles/storage.objectViewer' ([DateTimeOffset]::UtcNow) }
$policy = @{ version = 1; etag = 'unchanged'; bindings = @(@{ role = 'roles/storage.legacyBucketOwner'; members = @('projectOwner:synthetic') }); extra = 'preserve' }
$updated = Update-RecoveryBinding $policy $binding
Assert-Local ($policy.bindings.Count -eq 1 -and $updated.bindings.Count -eq 2 -and $updated.version -eq 3 -and $updated.etag -eq 'unchanged')
Assert-Rejected { Update-RecoveryBinding $updated $binding }
$updated.bindings += @{ role = 'roles/storage.objectViewer'; members = @('user:concurrent@example.invalid') }; $updated.etag = 'new-etag'
$removed = Update-RecoveryBinding $updated $binding -Remove
Assert-Local ($removed.bindings.Count -eq 2 -and $removed.etag -eq 'new-etag' -and $removed.extra -eq 'preserve')
Assert-Local ($null -eq (Update-RecoveryBinding $removed $binding -Remove))
$tampered = Copy-RecoveryPolicy $updated; $tampered.bindings[1].members += 'user:intruder@example.invalid'
Assert-Rejected { Update-RecoveryBinding $tampered $binding -Remove }
Assert-Rejected { Copy-RecoveryPolicy @{ version = 1; bindings = @() } }
$base = 'https://storage.googleapis.com/storage/v1/b/'
$path = [Uri]::EscapeDataString($objects[0].name)
$copyUrl = $base + $source + '/o/' + $path + '/rewriteTo/b/' + $backup + '/o/' + $path + '?sourceGeneration=123456&ifGenerationMatch=0'
$copyBody = @{ name = $objects[0].name; metadata = @{} }
Assert-RecoveryRequest 'POST' $copyUrl $buckets $copyBody
Assert-RecoveryRequest 'GET' ($base + $source + '/o?prefix=organizations%2F&maxResults=201') $buckets $null
Assert-RecoveryRequest 'GET' ($base + $backup + '/iam/testPermissions?permissions=storage.objects.get') $buckets $null
Assert-Rejected { Assert-RecoveryRequest 'DELETE' ($base + $source) $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'PATCH' ($base + $source) $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'POST' ($copyUrl.Replace('&ifGenerationMatch=0', '')) $buckets $copyBody }
Assert-Rejected { Assert-RecoveryRequest 'POST' ($copyUrl.Replace('sourceGeneration=123456', 'sourceGeneration=0')) $buckets $copyBody }
Assert-Rejected { Assert-RecoveryRequest 'POST' ($copyUrl.Replace('/rewriteTo/b/' + $backup, '/rewriteTo/b/' + $source)) $buckets $copyBody }
Assert-Rejected { Assert-RecoveryRequest 'GET' ($base + 'kreatum-dinamic.firebasestorage.app/iam') $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'GET' ($base + $source + '/o') $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'GET' ($base + $source + '/o?prefix=private%2F') $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'PUT' ($base + $source + '/o/' + $path) $buckets @{} }
Assert-Rejected { Assert-RecoveryRequest 'GET' ('http://storage.googleapis.com/storage/v1/b/' + $source) $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'GET' ('https://attacker.invalid/storage/v1/b/' + $source) $buckets $null }
Assert-Rejected { Assert-RecoveryRequest 'POST' ($base.TrimEnd('/') + '?project=kreatum-dinamic') $buckets (New-RecoveryBucketBody $backup 'EU') }
Assert-Local ((Get-RecoveryHash ([byte[]]@(97,98,99)) 3) -ceq 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
Assert-Rejected { Get-RecoveryHash ([byte[]]@(97,98,99)) 4 }
try { Stop-Recovery 'cloud-http-rejected' 403 } catch { $safe = Get-RecoveryFailure $_ }
Assert-Local ($safe.code -ceq 'cloud-http-rejected' -and $safe.httpStatus -eq 403)
try { throw 'SECRET FILE NAME TOKEN@example.invalid' } catch { $safe = Get-RecoveryFailure $_ }
Assert-Local (($safe | ConvertTo-Json -Compress) -notmatch 'SECRET|TOKEN|example')
# Mock network boundary, test continuation token, generation pinning, metadata stripping and MIME.
foreach ($case in @(
  @{ message = 'Invalid source generation: secret-path'; reason = 'invalid'; expected = 'invalid-generation' },
  @{ message = 'Legacy ACL not allowed with uniform bucket level access'; reason = 'badRequest'; expected = 'acl-policy' },
  @{ message = 'Invalid metadata for user@example.invalid'; reason = 'invalid'; expected = 'object-metadata' },
  @{ message = 'SECRET TOKEN@example.invalid'; reason = 'SECRET'; expected = 'unclassified' }
)) {
  $errorBody = @{ error = @{ message = $case.message; errors = @(@{ reason = $case.reason }) } } | ConvertTo-Json -Depth 6 -Compress
  $detail = Get-RecoveryCloudError ([Text.Encoding]::UTF8.GetBytes($errorBody))
  Assert-Local ($detail.ErrorClass -ceq $case.expected)
  Assert-Local (($detail | ConvertTo-Json -Compress) -notmatch 'SECRET|TOKEN|example|secret-path')
}
Assert-Local ((Get-RecoveryOperation 'POST' $copyUrl) -ceq 'object-rewrite')
Assert-Local ((Get-RecoveryOperation 'GET' ($base + $source + '/o/' + $path + '?alt=media&generation=123456')) -ceq 'object-read')
Assert-RecoveryRequest 'GET' ($base + $backup + '/o?maxResults=1&fields=items(name),nextPageToken') $buckets $null
Assert-Rejected { Assert-RecoveryRequest 'GET' ($base + $source + '/o?maxResults=1&fields=items(name),nextPageToken') $buckets $null }
$copyArguments = New-RecoveryCopyArguments $buckets $source $backup $inventory[0]
Assert-Local ($copyArguments[0] -ceq 'storage' -and $copyArguments[1] -ceq 'cp')
Assert-Local ($copyArguments[2] -ceq ('gs://' + $source + '/' + $inventory[0].name + '#123456'))
Assert-Local ($copyArguments[3] -ceq ('gs://' + $backup + '/' + $inventory[0].name))
foreach ($flag in @('--if-generation-match=0', '--clear-custom-metadata', '--cache-control=private,no-store', '--content-type=application/pdf', '--project=kreatum-dinamic-staging', '--quiet')) { Assert-Local ($flag -cin $copyArguments) }
Assert-Local ($copyArguments.Count -eq 10 -and ($copyArguments -join ' ') -notmatch '--recursive|--daisy-chain|--impersonate|\*')
Assert-Rejected { New-RecoveryCopyArguments $buckets $backup $source $inventory[0] }
Assert-Rejected { New-RecoveryCopyArguments $buckets $source $restore $inventory[0] }
Assert-Rejected { New-RecoveryCopyArguments $buckets 'production-bucket' $backup $inventory[0] }
Assert-Rejected { New-RecoveryCopyArguments $buckets $source $backup @{ name = 'organizations/a/*'; generation = '1'; size = '1' } }
Assert-Rejected { New-RecoveryCopyArguments $buckets $source $backup @{ name = $inventory[0].name; generation = '1 --impersonate'; size = '1' } }
Assert-Local ((Get-RecoveryContentType 'report.pptx') -ceq 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
Assert-Local ((Get-RecoveryContentType 'report.json') -ceq 'application/json')
$script:copyCalls = [Collections.Generic.List[object]]::new()
foreach ($cliCase in @(
  @{ text = 'HTTP403 PermissionDenied SECRET'; expected = 'cloud-copy-permission-denied' },
  @{ text = 'HTTP400 BadRequest SECRET'; expected = 'cloud-copy-bad-request' },
  @{ text = 'Unknown SECRET user@example.invalid'; expected = 'cloud-copy-command-failed' }
)) {
  $script:mockCliText = $cliCase.text
  function gcloud { $global:LASTEXITCODE = 1; return $script:mockCliText }
  $capturedCode = $null
  try { Invoke-RecoveryStorageCopy $copyArguments } catch { $capturedCode = $_.Exception.Data['SafeCode'] }
  Assert-Local ($capturedCode -ceq $cliCase.expected)
}
function gcloud { $global:LASTEXITCODE = 0; return 'SECRET user@example.invalid' }
Assert-Local ($null -eq (Invoke-RecoveryStorageCopy $copyArguments))
function Invoke-RecoveryStorageCopy([string[]]$Arguments) { $script:copyCalls.Add(@{ arguments = $Arguments }) }
function Invoke-RecoveryRequest($Client, [string]$Method, [string]$Url, [string[]]$Buckets, $Body = $null, [long]$MaximumBytes = 2MB, [switch]$Binary) {
  Assert-RecoveryRequest $Method $Url $Buckets $Body
  Assert-Local ($Method -ceq 'GET')
  return @{ bucket = $backup; name = $objects[0].name; generation = '987'; size = '3'; metadata = @{}; cacheControl = 'private,no-store'; contentType = 'application/pdf' }
}
$copied = Invoke-RecoveryCopy $null $buckets $source $backup $inventory[0]
Assert-Local ($copied.generation -eq '987' -and $script:copyCalls.Count -eq 1)
Assert-Local (($script:copyCalls[0].arguments -join '|') -ceq ($copyArguments -join '|'))
# No retry or metadata request after CLI rejects a copy.
$script:attempts = 0
function Invoke-RecoveryStorageCopy { $script:attempts++; Stop-Recovery 'cloud-copy-command-failed' }
function Invoke-RecoveryRequest { throw 'Must not read metadata after rejected copy.' }
Assert-Rejected { Invoke-RecoveryCopy $null $buckets $source $backup $inventory[0] }
Assert-Local ($script:attempts -eq 1)
@{ tests = $passed; status = 'passed'; cloudCalls = 0 } | ConvertTo-Json -Compress
