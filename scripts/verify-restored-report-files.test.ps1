#requires -Version 7.2
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Load ONLY function AST declarations. Never execute the script's cloud entry point.
$scriptPath = Join-Path $PSScriptRoot 'verify-restored-report-files.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'PowerShell parse failed.' }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($function.Extent.Text))
}
$passed = 0
function Assert-Local([bool]$Condition) { if (-not $Condition) { throw 'Local assertion failed.' }; $script:passed++ }
function Assert-Rejected([scriptblock]$Action) {
  $rejected = $false
  try { $null = & $Action } catch { $rejected = $true }
  Assert-Local $rejected
}
function New-SyntheticReferences {
  $entries = foreach ($index in 1..2) {
    $formats = @{}
    foreach ($format in @('pdf', 'pptx', 'json')) {
      $formats[$format] = @{ mapValue = @{ fields = @{
        storagePath = @{ stringValue = "organizations/synthetic/workshops/synthetic-workshop/reports/report$index.$format" }
        sha256 = @{ stringValue = ('a' * 64) }; size = @{ integerValue = '20' }
      } } }
    }
    @{ document = @{ name = "projects/kreatum-dinamic-staging/databases/security-restore-20260911/documents/organizations/synthetic/reports/report$index"; fields = @{ artifacts = @{ mapValue = @{ fields = $formats } } } } }
  }
  return ,@($entries)
}
$references = New-SyntheticReferences
$artifacts = Get-RestoredArtifacts $references
Assert-Local ($artifacts.Count -eq 6)
Assert-Rejected { Get-RestoredArtifacts @($references[0]) }
Assert-Rejected { Get-RestoredArtifacts @($references[0], $references[0]) }
foreach ($badPath in @('organizations/other/../reports/file.pdf', 'workshops/live/file.pdf', 'organizations/a/reports/quote".pdf')) {
  $bad = New-SyntheticReferences
  $bad[0].document.fields.artifacts.mapValue.fields.pdf.mapValue.fields.storagePath.stringValue = $badPath
  Assert-Rejected { Get-RestoredArtifacts $bad }
}
$bad = New-SyntheticReferences; $bad[0].document.fields.artifacts.mapValue.fields.pdf.mapValue.fields.sha256.stringValue = 'invalid'
Assert-Rejected { Get-RestoredArtifacts $bad }
$bad = New-SyntheticReferences; $bad[0].document.fields.artifacts.mapValue.fields.pdf.mapValue.fields.size.integerValue = '0'
Assert-Rejected { Get-RestoredArtifacts $bad }
$now = [DateTimeOffset]::Parse('2026-09-11T18:00:00Z')
$binding = New-ReadBinding $artifacts 'user:synthetic@example.invalid' ('security-restore-' + ('a' * 32)) $now
Assert-Local ($binding.role -eq 'roles/storage.objectViewer')
Assert-Local ($binding.condition.expression.Contains('request.time < timestamp("2026-09-11T19:00:00Z")'))
Assert-Local ([regex]::Matches($binding.condition.expression, 'projects/_/buckets/kreatum-dinamic-staging.firebasestorage.app/objects/').Count -eq 6)
Assert-Local (-not $binding.condition.expression.Contains('startsWith'))
Assert-Rejected { New-ReadBinding $artifacts 'serviceAccount:synthetic@example.invalid' ('security-restore-' + ('a' * 32)) $now }
$policy = @{ version = 1; etag = 'synthetic-etag'; bindings = @(@{ role = 'roles/storage.legacyBucketOwner'; members = @('projectOwner:synthetic') }); extra = @{ preserve = $true } }
$original = $policy | ConvertTo-Json -Depth 20 -Compress
$added = Add-ReadBinding $policy $binding
Assert-Local ($added.version -eq 3 -and $added.etag -eq 'synthetic-etag' -and $added.bindings.Count -eq 2)
Assert-Local (($policy | ConvertTo-Json -Depth 20 -Compress) -ceq $original)
Assert-Rejected { Add-ReadBinding $added $binding }
$added.bindings += @{ role = 'roles/storage.objectCreator'; members = @('user:concurrent@example.invalid') }
$added.etag = 'concurrent-etag'
$removed = Remove-ReadBinding $added $binding
Assert-Local ($removed.bindings.Count -eq 2 -and $removed.etag -eq 'concurrent-etag' -and $removed.extra.preserve)
Assert-Local ($removed.bindings[1].role -eq 'roles/storage.objectCreator')
Assert-Local ($null -eq (Remove-ReadBinding $removed $binding))
$tampered = Copy-Policy $added; $tampered.bindings[1].members += 'user:other@example.invalid'
Assert-Rejected { Remove-ReadBinding $tampered $binding }
Assert-Rejected { Copy-Policy @{ version = 1; bindings = @() } }
function gcloud { $script:capturedArguments = @($args); $global:LASTEXITCODE = 0; return 'synthetic-only' }
$privateResult = Invoke-GcloudPrivate @('config', 'get-value', 'account')
Assert-Local ($privateResult -ceq 'synthetic-only')
Assert-Local (($capturedArguments -join '|') -ceq 'config|get-value|account|--quiet')
$privateResult = Invoke-GcloudPrivate @('auth', 'print-access-token', '--account', 'synthetic@example.invalid')
Assert-Local (($capturedArguments -join '|') -ceq 'auth|print-access-token|--account|synthetic@example.invalid|--quiet')
foreach ($format in @('pdf', 'json', 'pptx')) {
  if ($format -eq 'pptx') {
    $memory = [IO.MemoryStream]::new()
    $zip = [IO.Compression.ZipArchive]::new($memory, [IO.Compression.ZipArchiveMode]::Create, $true)
    $null = $zip.CreateEntry('ppt/presentation.xml'); $zip.Dispose()
    $bytes = $memory.ToArray(); $memory.Dispose()
  } else { $bytes = [Text.Encoding]::UTF8.GetBytes($(if ($format -eq 'pdf') { '%PDF-1.7 synthetic' } else { '{"synthetic":true}' })) }
  $artifact = @{ format = $format; size = $bytes.Length; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() }
  Assert-Local (Test-ArtifactBytes $bytes $artifact)
  $artifact.size++; Assert-Rejected { Test-ArtifactBytes $bytes $artifact }; $artifact.size--
  $artifact.sha256 = '0' * 64; Assert-Rejected { Test-ArtifactBytes $bytes $artifact }
}
Assert-Rejected { Invoke-PrivateRequest $null 'GET' 'https://storage.googleapis.com/storage/v1/b/production/o/file' }
Assert-Rejected { Invoke-PrivateRequest $null 'GET' 'https://storage.googleapis.com/storage/v1/b/kreatum-dinamic-staging.firebasestorage.app/o' }
Assert-Rejected { Invoke-PrivateRequest $null 'PUT' 'https://storage.googleapis.com/storage/v1/b/kreatum-dinamic-staging.firebasestorage.app/o/file' }
Assert-Rejected { Invoke-PrivateRequest $null 'GET' 'https://example.invalid/private' }
try { Stop-Verification 'cloud-http-rejected' 403 } catch {
  $safe = Get-SafeFailure $_
  Assert-Local ($safe.code -eq 'cloud-http-rejected' -and $safe.httpStatus -eq 403 -and $safe.Count -eq 2)
}
@{ status = 'passed'; assertions = $passed; cloudExecuted = $false } | ConvertTo-Json -Compress
