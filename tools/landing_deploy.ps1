<#
把「跳板页」发布到 GitHub Pages 的 gh-pages 分支。

背景：Cloudflare 免费计划不接受子域（qiushui.qd.je）做站点，所以这个域名拿不到 Cloudflare 证书；
但 GitHub Pages 对任意 DNS 的 CNAME 子域会自动签 Let's Encrypt 证书。
于是：qiushui.qd.je = 一个固定入口页（托管在 GitHub Pages）；页面读取同目录的 target.txt，
自动跳到"当天那条临时隧道"。tunnel.ps1 每次启动成功后会自动调用本脚本更新 target.txt。

用法：
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\landing_deploy.ps1 -Url https://xxx.trycloudflare.com
可选：
  -Domain qiushui.qd.je   写进 CNAME（默认就是它）
  -Branch gh-pages        发布分支
  -DryRun                 只做本地提交、不推送
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$Domain = 'qiushui.qd.je',
  [string]$Branch = 'gh-pages',
  [switch]$DryRun
)

$root = Split-Path -Parent $PSScriptRoot
$git = 'D:\Program Files\Git\cmd\git.exe'
$src = Join-Path $root 'landing'
$tmp = Join-Path $env:TEMP ('ppr-landing-' + (Get-Date -Format 'yyyyMMddHHmmss'))

$Url = $Url.Trim()
if (-not ($Url -match '^https?://\S+$')) { throw "Url 必须是 http(s) 地址，收到：$Url" }
if (-not (Test-Path -LiteralPath (Join-Path $src 'index.html'))) { throw "缺少跳板页模板：$src\index.html" }

# git 会把普通进度信息写到 stderr；不能因为 stderr 有字就判失败，统一按 exit code 判断
function Invoke-Git {
  param([string]$Path = $root, [string[]]$Arguments, [switch]$AllowFail)
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $git -C $Path @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  $text = (($out | Out-String).Trim())
  if ($code -ne 0 -and -not $AllowFail) {
    throw ("git " + ($Arguments -join ' ') + " 失败 (exit $code)：`n" + $text)
  }
  return [pscustomobject]@{ Code = $code; Text = $text }
}

(Invoke-Git -Arguments @('fetch', 'origin', '--quiet') -AllowFail) | Out-Null
$remoteHas = (Invoke-Git -Arguments @('ls-remote', '--heads', 'origin', $Branch) -AllowFail).Text -match "refs/heads/$Branch"

$added = $false
if ($remoteHas) {
  Invoke-Git -Arguments @('worktree', 'add', '--force', '-B', $Branch, $tmp, "origin/$Branch") | Out-Null
} else {
  Invoke-Git -Arguments @('worktree', 'add', '--force', '--detach', $tmp) | Out-Null
  Invoke-Git -Path $tmp -Arguments @('checkout', '--orphan', $Branch) | Out-Null
  Invoke-Git -Path $tmp -Arguments @('rm', '-rf', '--quiet', '.') -AllowFail | Out-Null
}
$added = $true

try {
  Copy-Item -LiteralPath (Join-Path $src 'index.html') -Destination (Join-Path $tmp 'index.html') -Force
  [IO.File]::WriteAllText((Join-Path $tmp 'CNAME'), $Domain, (New-Object Text.UTF8Encoding $false))
  [IO.File]::WriteAllText((Join-Path $tmp 'target.txt'), $Url, (New-Object Text.UTF8Encoding $false))

  Invoke-Git -Path $tmp -Arguments @('add', '-A') | Out-Null
  $status = (Invoke-Git -Path $tmp -Arguments @('status', '--porcelain')).Text
  if ($status) {
    Invoke-Git -Path $tmp -Arguments @('commit', '-m', "landing: target -> $Url", '--quiet') | Out-Null
    if ($DryRun) {
      Write-Host "[DryRun] 已在临时工作区提交，未推送：$tmp" -ForegroundColor Yellow
    } else {
      Invoke-Git -Path $tmp -Arguments @('push', 'origin', $Branch, '--quiet') | Out-Null
      Write-Host "跳板页已发布：$Branch 分支 target.txt -> $Url" -ForegroundColor Green
    }
  } else {
    Write-Host '跳转目标没变化，无需重新发布' -ForegroundColor DarkGray
  }
} finally {
  if ($added -and -not $DryRun) {
    try { Invoke-Git -Arguments @('worktree', 'remove', '--force', $tmp) -AllowFail | Out-Null } catch { }
  }
}
