<#
.SYNOPSIS
    把本仓库推送到 GitHub，可选地一并开启 GitHub Pages（网站根目录为 docs/）。

.DESCRIPTION
    - 自动寻找 git.exe（PATH 里没有就找默认安装位置）
    - 用 Personal Access Token 推送，推送结束后会把远端地址还原成不含令牌的形式
    - -EnablePages 时调用 GitHub API 打开 Pages，并输出最终访问地址

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/push-to-github.ps1 `
        -UserName "yourname" -Repo "imagegrab" -Token "ghp_xxx" -EnablePages
#>
[CmdletBinding()]
param(
    [string]$UserName,
    [string]$Repo = "imagegrab",
    [string]$Token,
    [string]$RepoUrl,
    [switch]$EnablePages
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

# ---------- 1. 找到 git ----------
$git = (Get-Command git -ErrorAction SilentlyContinue)?.Source
if (-not $git) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files (x86)\Git\cmd\git.exe"
    )
    $git = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $git) { throw "没有找到 git.exe，请先安装 Git：https://git-scm.com/downloads" }
Write-Host "使用 git：$git" -ForegroundColor DarkGray

# ---------- 2. 补齐参数 ----------
if (-not $UserName) { $UserName = Read-Host "GitHub 用户名" }
if (-not $Repo) { $Repo = Read-Host "仓库名（默认 imagegrab）" }
if (-not $Token) {
    $secure = Read-Host "粘贴 Personal Access Token（输入内容不会显示）" -AsSecureString
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $RepoUrl) { $RepoUrl = "https://github.com/$UserName/$Repo.git" }

# ---------- 3. 推送 ----------
$authUrl = "https://$UserName`:$Token@github.com/$UserName/$Repo.git"
Write-Host "`n[1/3] 关联远端 $RepoUrl" -ForegroundColor Cyan
& $git remote remove origin 2>$null
& $git remote add origin $RepoUrl

Write-Host "[2/3] 推送到 main（首次会自动创建）" -ForegroundColor Cyan
& $git -c http.schannelCheckRevoke=false push $authUrl "HEAD:refs/heads/main" --force
if ($LASTEXITCODE -ne 0) { throw "推送失败，请检查令牌权限（需要 repo 或 Contents: write）" }

# 用干净的地址（不含令牌）作为 upstream，避免令牌写进 .git/config
& $git remote set-url origin $RepoUrl
& $git fetch origin main 2>$null
& $git branch --set-upstream-to=origin/main main 2>$null

Write-Host "推送完成 ✓" -ForegroundColor Green

# ---------- 4. 可选：开启 GitHub Pages ----------
if (-not $EnablePages) {
    Write-Host "`n如需开启 GitHub Pages，可加 -EnablePages 参数，或到仓库 Settings → Pages 手动选择 main 分支 /docs 目录。" -ForegroundColor DarkGray
    return
}

Write-Host "`n[3/3] 开启 GitHub Pages（main 分支 /docs 目录）" -ForegroundColor Cyan
$headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$body = @{ source = @{ branch = "main"; path = "/docs" } } | ConvertTo-Json

try {
    Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$UserName/$Repo/pages" `
        -Headers $headers -Body $body -ContentType "application/json" | Out-Null
    Write-Host "Pages 已创建 ✓" -ForegroundColor Green
} catch {
    # 409 = 已经配置过，直接更新
    try {
        Invoke-RestMethod -Method Put -Uri "https://api.github.com/repos/$UserName/$Repo/pages" `
            -Headers $headers -Body $body -ContentType "application/json" | Out-Null
        Write-Host "Pages 已更新 ✓" -ForegroundColor Green
    } catch {
        Write-Warning "自动开启 Pages 失败：$($_.Exception.Message)"
        Write-Host "请到 https://github.com/$UserName/$Repo/settings/pages 手动选择 main 分支 + /docs 目录。" -ForegroundColor Yellow
    }
}

Write-Host "`n几分钟后访问： https://$UserName.github.io/$Repo/" -ForegroundColor Green
