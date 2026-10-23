# Compiles the actual declaration only. Does not run UIA, query applications or send input.
param([Parameter(Mandatory=$true)][string]$Helper)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$tokens=$null;$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Helper,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'helper-parser-failed'}
$source=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.StringConstantType -eq 'SingleQuotedHereString'},$true)[0].Value
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -ReferencedAssemblies System.dll,System.Core.dll,UIAutomationClient,UIAutomationTypes,WindowsBase -TypeDefinition $source -ErrorAction Stop
function Require($condition){if(-not $condition){throw 'arm-state-regression'}}
$arm=New-Object SendArmState('button-a','composer-a/editor-a',1)
$arm.ObserveReady($false)
Require ($arm.TryConsume('button-a','composer-a/editor-a',1))
Require (-not $arm.TryConsume('button-a','composer-a/editor-a',1))
Require (-not $arm.TryConsume('button-a','composer-a/editor-a',1))
Require (-not $arm.CanRearm)
$arm.ObserveReady($true)
Require $arm.CanRearm
$arm.Retire()
Require (-not $arm.TryConsume('button-a','composer-a/editor-a',1))
$next=New-Object SendArmState('button-a','composer-a/editor-a',2)
Require (-not $next.TryConsume('button-a','composer-b/editor-b',2))
Require (-not $next.TryConsume('button-b','composer-a/editor-a',2))
Require (-not $next.TryConsume('button-a','composer-a/editor-a',1))
Require ($next.TryConsume('button-a','composer-a/editor-a',2))
$next.ObserveReady($true)
Require (-not $next.CanRearm)
[ordered]@{transitionedSendConsumed=$true;laterStopRejected=$true;duplicateRejected=$true;independentLifecycleAccepted=$true;wrongComposerRejected=$true;wrongTargetRejected=$true;staleGenerationRejected=$true;retiredArmRejected=$true}|ConvertTo-Json -Compress
