$ErrorActionPreference = "Stop"

$repo = "kingpumpski/audit-ledger"
$names = @(
  "DEV_VITE_SUPABASE_PROJECT_ID",
  "DEV_VITE_SUPABASE_URL",
  "DEV_VITE_SUPABASE_PUBLISHABLE_KEY"
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required. Install it from https://cli.github.com/ and run 'gh auth login'."
}

$values = @{}
foreach ($name in $names) {
  $value = gh api "repos/$repo/actions/variables/$name" --jq ".value" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
    throw "Missing GitHub repository variable '$name'. Add it under Settings > Secrets and variables > Actions > Variables."
  }
  $values[$name] = $value.Trim()
}

$projectId = $values["DEV_VITE_SUPABASE_PROJECT_ID"]
$url = $values["DEV_VITE_SUPABASE_URL"].TrimEnd("/")
$key = $values["DEV_VITE_SUPABASE_PUBLISHABLE_KEY"]

if ($projectId -eq "phfpbqlhxagonpofzvtn" -or $url -eq "https://phfpbqlhxagonpofzvtn.supabase.co") {
  throw "Refusing to configure local development against the production Supabase project."
}
if ($url -notmatch "^https://$([regex]::Escape($projectId))\.supabase\.co$") {
  throw "Development project ID and URL do not match. Check DEV_VITE_SUPABASE_PROJECT_ID and DEV_VITE_SUPABASE_URL."
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
Write-Host "Created .env.local using development-only GitHub variables."
Write-Host "Restart Vite with: npm run dev"
