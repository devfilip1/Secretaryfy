# Shortcuts for the project commands. Usage: .\run.ps1 <shortcut> [arguments]
# The same names exist in the Makefile; a test checks that the two files do not drift apart.

$Shortcuts = [ordered]@{
    "help"             = @("", "List the shortcuts")
    "install"          = @("-m pip install -r requirements.txt", "Install the dependencies")
    "ingest"           = @("-m assistant.ingest", "Build the indexes of every strategy")
    "chat"             = @("-m assistant.chat", "Chat with the assistant")
    "test"             = @("-m pytest", "Unit tests (no Ollama needed)")
    "test-integration" = @("-m pytest -m integration", "Tests with Ollama and the index")
    "eval"             = @("-m evaluation run --no-judge", "Answer evaluation, without the judge")
    "eval-smoke"       = @("-m evaluation run --smoke --no-judge", "Quick evaluation, 10 questions")
    "eval-full"        = @("-m evaluation run", "Answer evaluation, with the judge")
    "experiments"      = @("-m evaluation experiments", "Compare the search experiments")
    "retrieval"        = @("-m evaluation retrieval", "Search detail of the assistant's experiment")
    "kb-check"         = @("-m evaluation kb-check", "Check the knowledge base")
    "validate"         = @("-m evaluation validate", "Validate the configuration and the answer key")
    "compare"          = @("-m evaluation compare", "Compare the latest evaluation with the reference")
    "baseline"         = @("-m evaluation baseline set", "Set the latest evaluation as the reference")
    "serve"            = @("-m server", "Start the assistant HTTP service")
}

function Show-Shortcuts {
    Write-Host "Usage: .\run.ps1 <shortcut> [arguments]"
    Write-Host ""
    foreach ($name in $Shortcuts.Keys) {
        Write-Host ("  {0,-18} {1}" -f $name, $Shortcuts[$name][1])
    }
}

$name = if ($args.Count -gt 0) { $args[0] } else { "help" }
$rest = @($args | Select-Object -Skip 1)

if ($name -eq "help") {
    Show-Shortcuts
    exit 0
}

if (-not $Shortcuts.Contains($name)) {
    Write-Host "The shortcut '$name' does not exist."
    Write-Host ""
    Show-Shortcuts
    exit 2
}

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Virtual environment not found. Create it with: python -m venv .venv"
    Write-Host "Then install the dependencies: .\run.ps1 install"
    exit 1
}

Push-Location $PSScriptRoot
try {
    $command = $Shortcuts[$name][0] -split " "
    if ([Console]::IsInputRedirected) {
        $input | & $python @command @rest   # forwards the input when the shortcut receives text through a pipe
    }
    else {
        & $python @command @rest
    }
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}
exit $code
