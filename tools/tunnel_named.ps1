<#
固定域名的具名隧道（named tunnel）——启动 / 查状态 / 停止。
和 tools\tunnel.ps1 的区别：那条是"无账号临时隧道"，网址每次随机；
这条走 Cloudflare 账号里创建好的具名隧道，域名写死在 config.yml，每次启动都是同一个网址。

前置（一次性，只需做一次）：
  1) 域名托管到 Cloudflare（NS 改成 Cloudflare 给的两个地址，状态变 Active）
  2) .\cloudflared.exe tunnel login
  3) .\cloudflared.exe tunnel create qiu
  4) .\cloudflared.exe tunnel route dns qiu qiushui.qd.je
  5) 复制 cloudflared\config.example.yml 为 cloudflared\config.yml，填 UUID

日常三条（在仓库根目录）：
  启动：powershell -NoProfile -ExecutionPolicy Bypass -File tools\tunnel_named.ps1
  状态：powershell ... -File tools\tunnel_named.ps1 -Status
  停止：powershell ... -File tools\tunnel_named.ps1 -Stop
#>
param(
  [string]$Name = 'qiu',
  [string]$Hostname = 'qiushui.qd.je',
  [int]$Port = 8000,
  [switch]$Stop,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$node = 'E:\Program Files\nodejs\node.exe'
$npm = 'E:\Program Files\nodejs\npm.cmd'
$logs = Join-Path $root 'tools'
$cf = Join-Path $root 'cloudflared.exe'
$cfgDir = Join-Path $root 'cloudflared'
$cfg = Join-Path $cfgDir 'config.yml'

function Get-NamedTunnels {
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*tunnel*run*$Name*" }
}

# ---------- -Status ----------
if ($Status) {
  $srvPid = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  $tun = @(Get-NamedTunnels)
  if ($srvPid) { Write-Host "[服务] 端口 $Port 在跑（pid $srvPid）" -ForegroundColor Green } else { Write-Host "[服务] 端口 $Port 没在跑" -ForegroundColor Yellow }
  if ($tun.Count -gt 0) {
    Write-Host "[隧道] 具名隧道 $Name 在跑（pid $(($tun | ForEach-Object { $_.ProcessId }) -join ', ')）" -ForegroundColor Green
    Write-Host "[网址] https://$Hostname （固定）" -ForegroundColor Green
    try { $h = Invoke-RestMethod "https://$Hostname/health" -TimeoutSec 20; Write-Host ("[公网] 健康检查 " + ($h | ConvertTo-Json -Compress)) -ForegroundColor DarkGray }
    catch { Write-Host '[公网] /health 现在不通（隧道没连上或域名未激活）' -ForegroundColor Yellow }
  } else {
    Write-Host "[隧道] 具名隧道 $Name 没在跑" -ForegroundColor Yellow
  }
  exit 0
}

# ---------- -Stop ----------
if ($Stop) {
  $tun = @(Get-NamedTunnels)
  foreach ($t in $tun) { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "已关掉具名隧道 pid $($t.ProcessId)" }
  $srvPid = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  if ($srvPid) { Stop-Process -Id $srvPid -Force -ErrorAction SilentlyContinue; Write-Host "已关掉服务 pid $srvPid（端口 $Port）" }
  if ($tun.Count -eq 0 -and -not $srvPid) { Write-Host '本来就没在跑' -ForegroundColor DarkGray }
  exit 0
}

# ---------- 启动 ----------
function Fail($msg) {
  Write-Host $msg -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $cf)) { Fail "缺少 $cf —— 先跑一次 tools\tunnel.ps1（它会下载 cloudflared）" }
if (-not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.cloudflared\cert.pem'))) {
  Fail "还没登录 Cloudflare。先执行：`n  .\cloudflared.exe tunnel login`n然后在浏览器里选中 $Hostname 授权（会生成 %USERPROFILE%\.cloudflared\cert.pem）。"
}
if (-not (Test-Path -LiteralPath $cfg)) {
  Fail "缺少配置文件：$cfg`n把 cloudflared\config.example.yml 复制成 config.yml，并把 credentials-file 换成 .cloudflared\<UUID>.json 的真实路径。"
}

# 1) 整站服务
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host "[1/2] 起整站服务 0.0.0.0:$Port …" -ForegroundColor Cyan
  $env:PORT = "$Port"
  Start-Process -FilePath $node -ArgumentList 'server/index.mjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs '_named_srv.out') -RedirectStandardError (Join-Path $logs '_named_srv.err') | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Host "[1/2] 端口 $Port 已有服务在跑，直接复用" -ForegroundColor DarkGray
}
try { $h = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 10 } catch { throw "本地 /health 不通：$($_.Exception.Message)" }
Write-Host ("      本地健康检查: " + ($h | ConvertTo-Json -Compress)) -ForegroundColor DarkGray

# 2) 具名隧道（先清掉同名的旧进程）
$old = @(Get-NamedTunnels)
foreach ($o in $old) { Stop-Process -Id $o.ProcessId -Force -ErrorAction SilentlyContinue }
if ($old) { Write-Host "      已关掉上一次的具名隧道（$($old.Count) 条）" -ForegroundColor DarkGray }

$stamp = Get-Date -Format 'MMdd-HHmmss'
$tunLog = Join-Path $logs ('_named_' + $stamp + '.log')
$tunErr = Join-Path $logs ('_named_' + $stamp + '.err')
$p = Start-Process -FilePath $cf -ArgumentList 'tunnel', '--config', $cfg, 'run', $Name, '--logfile', $tunLog, '--loglevel', 'info' `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs ('_named_' + $stamp + '.out')) -RedirectStandardError $tunErr

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $tunLog) {
    if (Select-String -LiteralPath $tunLog -Pattern 'Registered tunnel connection' -SimpleMatch -Quiet) { $ok = $true; break }
  }
  if ($p.HasExited) { break }
}
if (-not $ok) {
  $tail = ''
  if (Test-Path -LiteralPath $tunLog) { $tail = (Get-Content -LiteralPath $tunLog -Tail 4) -join ' | ' }
  $errTail = ''
  if (Test-Path -LiteralPath $tunErr) { $errTail = (Get-Content -LiteralPath $tunErr -Tail 4) -join ' | ' }
  $why = if ($p.HasExited) { "cloudflared 已退出（exit=$($p.ExitCode)）" } else { '80 秒内没看到 Registered tunnel connection' }
  throw "具名隧道没连上：$why`n常见原因：域名还没在 Cloudflare 变 Active / config.yml 的 UUID 不对 / 未执行 tunnel route dns。`n日志：$tunLog`n$tail`n$errTail"
}

# 3) 固定网址 + 双校（HTTP 与 WebSocket）
Write-Host ''
Write-Host '  固定网址（每次启动都是这个）：' -ForegroundColor Green
Write-Host "  https://$Hostname" -ForegroundColor Green
$public = $null
for ($i = 1; $i -le 6; $i++) {
  try { $public = Invoke-RestMethod "https://$Hostname/health" -TimeoutSec 25; break }
  catch { if ($i -lt 6) { Start-Sleep -Seconds 5 } }
}
if ($public) { Write-Host ("      公网健康检查: " + ($public | ConvertTo-Json -Compress)) -ForegroundColor DarkGray }
else { Write-Host '      公网 /health 还没通（证书生效/DNS 传播可能还要几分钟）' -ForegroundColor Yellow }
"https://$Hostname" | Out-File -Encoding utf8 (Join-Path $logs '_named_url.txt')
