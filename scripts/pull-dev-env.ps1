$ErrorActionPreference = "Stop"

$repo = "kingpumpski/audit-ledger"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required. Install it from https://cli.github.com/ and run 'gh auth login'."
}

function Get-RepositoryVariable([string]$name) {
  $value = gh api "repos/$repo/actions/variables/$name" --jq ".value" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
    return $null
  }
  return $value.Trim()
}

# Prefer dedicated development values. Fall back to the standard Vite values
# only when they point to a non-production project.
$prefix = "DEV_"
$projectId = Get-RepositoryVariable "DEV_VITE_SUPABASE_PROJECT_ID"
$url = Get-RepositoryVariable "DEV_VITE_SUPABASE_URL"
$key = Get-RepositoryVariable "DEV_VITE_SUPABASE_PUBLISHABLE_KEY"

if ([string]::IsNullOrWhiteSpace($projectId) -or
    [string]::IsNullOrWhiteSpace($url) -or
    [string]::IsNullOrWhiteSpace($key)) {
  $prefix = ""
  $projectId = Get-RepositoryVariable "VITE_SUPABASE_PROJECT_ID"
  $url = Get-RepositoryVariable "VITE_SUPABASE_URL"
  $key = Get-RepositoryVariable "VITE_SUPABASE_PUBLISHABLE_KEY"
}

if ([string]::IsNullOrWhiteSpace($projectId) -or
    [string]::IsNullOrWhiteSpace($url) -or
    [string]::IsNullOrWhiteSpace($key)) {
  throw "Supabase repository variables are incomplete. Add DEV_VITE_SUPABASE_* variables for development, or VITE_SUPABASE_* variables that target a non-production project."
}

$projectId = $projectId.Trim()
$url = $url.Trim().TrimEnd("/")
$key = $key.Trim()

if ($projectId -eq "phfpbqlhxagonpofzvtn" -or $url -eq "https://phfpbqlhxagonpofzvtn.supabase.co") {
  throw "Refusing to configure local development against the production Supabase project. Add DEV_VITE_SUPABASE_* variables for your development Supabase project."
}
if ($url -notmatch "^https://$([regex]::Escape($projectId))\.supabase\.co$") {
  throw "Supabase project ID and URL do not match. Check the GitHub Actions variables."
}
if ($key -match "service_role|sb_secret") {
  throw "A secret/service-role key was supplied. Use the project's publishable key only."
}

$lines = @(
  "VITE_SUPABASE_PROJECT_ID=$projectId",
  "VITE_SUPABASE_URL=$url",
  "VITE_SUPABASE_PUBLISHABLE_KEY=$key"
)
Set-Content -Path ".env.local" -Value $lines -Encoding utf8
Write-Host "Created .env.local using GitHub repository variables ($prefix Vite configuration)."
Write-Host "Restart Vite with: npm run dev"
