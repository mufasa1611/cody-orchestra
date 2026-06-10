param([string]$Root)

$options = @("CLI (Terminal UI)", "Web UI (Browser)")
$selected = 0
$esc = [char]0x1b
$up = [char]0x2191
$down = [char]0x2193
$menuHeight = $options.Length + 5
$first = $true
try {
    try { [Console]::CursorVisible = $false } catch {}
    $host.UI.RawUI.FlushInputBuffer()
    do {
        if (-not $first) {
            Write-Host "${esc}[${menuHeight}A${esc}[J" -NoNewline
        } else {
            $first = $false
        }
        Write-Host ""
        Write-Host "  codyx Launcher"
        Write-Host ""
        for ($i = 0; $i -lt $options.Length; $i++) {
            if ($i -eq $selected) {
                Write-Host "${esc}[38;5;214m  > $($options[$i])${esc}[0m"
            } else {
                Write-Host "${esc}[2m    $($options[$i])${esc}[0m"
            }
        }
        Write-Host ""
        Write-Host "  (${up}/${down} to move, Enter to select)"
        $key = $host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        if ($key.VirtualKeyCode -eq 38) { $selected = ($selected - 1 + $options.Length) % $options.Length }
        elseif ($key.VirtualKeyCode -eq 40) { $selected = ($selected + 1) % $options.Length }
        elseif ($key.VirtualKeyCode -eq 27) { $selected = 255; break }
    } until ($key.VirtualKeyCode -eq 13)
} finally {
    try { [Console]::CursorVisible = $true } catch {}
    $host.UI.RawUI.FlushInputBuffer()
}

exit $selected
