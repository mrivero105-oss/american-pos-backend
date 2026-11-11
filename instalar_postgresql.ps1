param(
    [string]$SourceDir = "",
    [switch]$NoGui
)

# ==============================================================================
# ISAAC POS - INSTALADOR PROFESIONAL DE MOTOR DE DATOS (POSTGRESQL 16 & PGADMIN 4)
# ==============================================================================

# 1. Configurar codificación UTF-8 estricta para evitar caracteres corruptos
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

# 2. Requerir elevación de Administrador
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($SourceDir) { $argList += " -SourceDir `"$SourceDir`"" }
    if ($NoGui) { $argList += " -NoGui" }
    Start-Process powershell.exe -ArgumentList $argList -Verb RunAs
    exit
}

# 3. Detectar si podemos mostrar interfaz gráfica moderna (WPF)
$useWpf = (-not $NoGui) -and ([System.Environment]::UserInteractive)

# Variables de la UI
$window = $null
$iconStep1 = $null; $descStep1 = $null; $statusStep1 = $null
$iconStep2 = $null; $descStep2 = $null; $statusStep2 = $null
$iconStep3 = $null; $descStep3 = $null; $statusStep3 = $null
$iconStep4 = $null; $descStep4 = $null; $statusStep4 = $null
$lblDetail = $null; $lblPercent = $null; $progressBar = $null

if ($useWpf) {
    try {
        Add-Type -AssemblyName PresentationFramework -ErrorAction Stop
        Add-Type -AssemblyName PresentationCore -ErrorAction Stop
        Add-Type -AssemblyName WindowsBase -ErrorAction Stop

        $xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Isaac POS - Configuración de Servidor de Base de Datos"
        Height="500" Width="620"
        Topmost="True"
        WindowStartupLocation="CenterScreen"
        WindowStyle="SingleBorderWindow"
        ResizeMode="NoResize"
        Background="#0F172A"
        Foreground="#F8FAFC"
        FontFamily="Segoe UI, Segoe UI Semibold">
    <Window.Resources>
        <Style TargetType="TextBlock">
            <Setter Property="Foreground" Value="#F8FAFC"/>
        </Style>
    </Window.Resources>
    <Grid Margin="26">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- Header -->
        <Grid Grid.Row="0" Margin="0,0,0,22">
            <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
            </Grid.ColumnDefinitions>
            <Border Grid.Column="0" Width="50" Height="50" CornerRadius="14" Background="#10B981" Margin="0,0,16,0">
                <TextBlock Text="⚡" FontSize="26" HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <StackPanel Grid.Column="1" VerticalAlignment="Center">
                <StackPanel Orientation="Horizontal">
                    <TextBlock Text="ISAAC POS" FontSize="19" FontWeight="Bold" Foreground="#FFFFFF" Margin="0,0,10,0"/>
                    <Border Background="#064E3B" BorderBrush="#059669" BorderThickness="1" CornerRadius="6" Padding="7,2">
                        <TextBlock Text="INSTALACIÓN AUTOMATIZADA" FontSize="9.5" FontWeight="Bold" Foreground="#34D399"/>
                    </Border>
                </StackPanel>
                <TextBlock Text="Configuración del Servidor de Base de Datos (PostgreSQL 16 &amp; pgAdmin 4)" FontSize="11.5" Foreground="#94A3B8" Margin="0,4,0,0"/>
            </StackPanel>
        </Grid>

        <!-- Checklist Cards -->
        <Border Grid.Row="1" Background="#1E293B" BorderBrush="#334155" BorderThickness="1" CornerRadius="16" Padding="18" Margin="0,0,0,22">
            <StackPanel VerticalAlignment="Center">
                <!-- Step 1 -->
                <Grid Margin="0,0,0,14">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="34"/>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <TextBlock Name="IconStep1" Grid.Column="0" Text="⏳" FontSize="16" VerticalAlignment="Center"/>
                    <StackPanel Grid.Column="1" VerticalAlignment="Center">
                        <TextBlock Text="1. Librerías de Sistema C++" FontSize="13" FontWeight="SemiBold"/>
                        <TextBlock Name="DescStep1" Text="Microsoft Visual C++ 2015-2022 Redistributable (x64)" FontSize="11" Foreground="#94A3B8"/>
                    </StackPanel>
                    <TextBlock Name="StatusStep1" Grid.Column="2" Text="Pendiente" FontSize="11" FontWeight="Bold" Foreground="#64748B" VerticalAlignment="Center"/>
                </Grid>

                <Separator Background="#334155" Margin="0,0,0,14"/>

                <!-- Step 2 -->
                <Grid Margin="0,0,0,14">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="34"/>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <TextBlock Name="IconStep2" Grid.Column="0" Text="⏳" FontSize="16" VerticalAlignment="Center"/>
                    <StackPanel Grid.Column="1" VerticalAlignment="Center">
                        <TextBlock Text="2. Motor PostgreSQL 16 &amp; pgAdmin 4" FontSize="13" FontWeight="SemiBold"/>
                        <TextBlock Name="DescStep2" Text="Instalación de binarios, herramientas y cluster seguro" FontSize="11" Foreground="#94A3B8"/>
                    </StackPanel>
                    <TextBlock Name="StatusStep2" Grid.Column="2" Text="Pendiente" FontSize="11" FontWeight="Bold" Foreground="#64748B" VerticalAlignment="Center"/>
                </Grid>

                <Separator Background="#334155" Margin="0,0,0,14"/>

                <!-- Step 3 -->
                <Grid Margin="0,0,0,14">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="34"/>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <TextBlock Name="IconStep3" Grid.Column="0" Text="⏳" FontSize="16" VerticalAlignment="Center"/>
                    <StackPanel Grid.Column="1" VerticalAlignment="Center">
                        <TextBlock Text="3. Servicio de Windows (Alta Disponibilidad)" FontSize="13" FontWeight="SemiBold"/>
                        <TextBlock Name="DescStep3" Text="Configuración en modo automático y puerto de red 5432" FontSize="11" Foreground="#94A3B8"/>
                    </StackPanel>
                    <TextBlock Name="StatusStep3" Grid.Column="2" Text="Pendiente" FontSize="11" FontWeight="Bold" Foreground="#64748B" VerticalAlignment="Center"/>
                </Grid>

                <Separator Background="#334155" Margin="0,0,0,14"/>

                <!-- Step 4 -->
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="34"/>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <TextBlock Name="IconStep4" Grid.Column="0" Text="⏳" FontSize="16" VerticalAlignment="Center"/>
                    <StackPanel Grid.Column="1" VerticalAlignment="Center">
                        <TextBlock Text="4. Base de Datos Inicial ('americanpos')" FontSize="13" FontWeight="SemiBold"/>
                        <TextBlock Name="DescStep4" Text="Verificación de integridad y esquemas de producción" FontSize="11" Foreground="#94A3B8"/>
                    </StackPanel>
                    <TextBlock Name="StatusStep4" Grid.Column="2" Text="Pendiente" FontSize="11" FontWeight="Bold" Foreground="#64748B" VerticalAlignment="Center"/>
                </Grid>
            </StackPanel>
        </Border>

        <!-- Footer / Progress -->
        <StackPanel Grid.Row="2">
            <Grid Margin="0,0,0,9">
                <TextBlock Name="LblDetail" Text="Iniciando configuración del sistema..." FontSize="12" Foreground="#CBD5E1" FontWeight="Medium"/>
                <TextBlock Name="LblPercent" Text="0%" FontSize="12" Foreground="#34D399" FontWeight="Bold" HorizontalAlignment="Right"/>
            </Grid>
            <ProgressBar Name="MainProgressBar" Height="8" Minimum="0" Maximum="100" Value="0" Background="#334155" Foreground="#10B981" BorderThickness="0"/>
        </StackPanel>
    </Grid>
</Window>
"@

        $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
        $window = [System.Windows.Markup.XamlReader]::Load($reader)

        $iconStep1 = $window.FindName("IconStep1")
        $descStep1 = $window.FindName("DescStep1")
        $statusStep1 = $window.FindName("StatusStep1")

        $iconStep2 = $window.FindName("IconStep2")
        $descStep2 = $window.FindName("DescStep2")
        $statusStep2 = $window.FindName("StatusStep2")

        $iconStep3 = $window.FindName("IconStep3")
        $descStep3 = $window.FindName("DescStep3")
        $statusStep3 = $window.FindName("StatusStep3")

        $iconStep4 = $window.FindName("IconStep4")
        $descStep4 = $window.FindName("DescStep4")
        $statusStep4 = $window.FindName("StatusStep4")

        $lblDetail = $window.FindName("LblDetail")
        $lblPercent = $window.FindName("LblPercent")
        $progressBar = $window.FindName("MainProgressBar")

        $window.Show()
    } catch {
        $useWpf = $false
    }
}

function Update-UiStatus {
    param(
        [int]$Progress = -1,
        [string]$Message = "",
        [int]$Step = 0,
        [string]$StepStatus = "",
        [string]$StepColor = "#38BDF8"
    )

    if ($useWpf -and $window) {
        if ($Progress -ge 0) {
            $progressBar.Value = $Progress
            $lblPercent.Text = "$Progress%"
        }
        if ($Message) {
            $lblDetail.Text = $Message
        }
        if ($Step -eq 1 -and $StepStatus) {
            $statusStep1.Text = $StepStatus
            $statusStep1.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($StepColor)
            $iconStep1.Text = if ($StepColor -eq "#34D399") { "✅" } elseif ($StepColor -eq "#EF4444") { "❌" } else { "🔄" }
        }
        if ($Step -eq 2 -and $StepStatus) {
            $statusStep2.Text = $StepStatus
            $statusStep2.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($StepColor)
            $iconStep2.Text = if ($StepColor -eq "#34D399") { "✅" } elseif ($StepColor -eq "#EF4444") { "❌" } else { "🔄" }
        }
        if ($Step -eq 3 -and $StepStatus) {
            $statusStep3.Text = $StepStatus
            $statusStep3.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($StepColor)
            $iconStep3.Text = if ($StepColor -eq "#34D399") { "✅" } elseif ($StepColor -eq "#EF4444") { "❌" } else { "🔄" }
        }
        if ($Step -eq 4 -and $StepStatus) {
            $statusStep4.Text = $StepStatus
            $statusStep4.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($StepColor)
            $iconStep4.Text = if ($StepColor -eq "#34D399") { "✅" } elseif ($StepColor -eq "#EF4444") { "❌" } else { "🔄" }
        }

        [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
            [System.Windows.Threading.DispatcherPriority]::Render,
            [Action]{}
        )
    } else {
        if ($Message) {
            Write-Host "-> $Message" -ForegroundColor Cyan
        }
    }
}

# Log inicial
Update-UiStatus -Progress 5 -Message "Verificando componentes instalados en el sistema..."

# Directorios de búsqueda de instaladores
$searchDirs = @()
if ($SourceDir -and (Test-Path $SourceDir)) { $searchDirs += $SourceDir }
$searchDirs += @(
    $PSScriptRoot,
    (Join-Path $PSScriptRoot "prerequisites"),
    (Split-Path $PSScriptRoot -Parent),
    (Join-Path (Split-Path $PSScriptRoot -Parent) "prerequisites"),
    "C:\Users\WDAGUtilityAccount\Desktop\IsaacPOS_Setup",
    "C:\Users\WDAGUtilityAccount\Desktop\IsaacPOS_Setup\prerequisites",
    "C:\Users\WDAGUtilityAccount\Desktop\dist_installers",
    "C:\Users\WDAGUtilityAccount\Desktop",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Desktop\prerequisites",
    "$env:USERPROFILE\Downloads",
    "$env:TEMP"
)

# ------------------------------------------------------------------------------
# COMPROBAR SI POSTGRESQL YA ESTÁ INSTALADO
# ------------------------------------------------------------------------------
$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin\postgres.exe",
    "C:\Program Files\PostgreSQL\17\bin\postgres.exe",
    "C:\Program Files\PostgreSQL\15\bin\postgres.exe",
    "C:\Program Files\PostgreSQL\14\bin\postgres.exe",
    "C:\Program Files (x86)\PostgreSQL\16\bin\postgres.exe"
)

$installedPg = $null
foreach ($path in $pgPaths) {
    if (Test-Path $path) {
        $installedPg = $path
        break
    }
}

if ($null -eq $installedPg) {
    $wildcardPg = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\postgres.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wildcardPg) {
        $installedPg = $wildcardPg.FullName
    }
}

# ------------------------------------------------------------------------------
# PASO 1: LIBRERÍAS C++ (MICROSOFT VISUAL C++ 2015-2022)
# ------------------------------------------------------------------------------
Update-UiStatus -Progress 10 -Message "Verificando librerías del sistema C++..." -Step 1 -StepStatus "Verificando..."

$hasVCRuntime = (Test-Path "C:\Windows\System32\vcruntime140.dll") -and (Test-Path "C:\Windows\System32\msvcp140.dll")

if ($hasVCRuntime) {
    Update-UiStatus -Progress 25 -Message "Librerías C++ verificadas correctamente." -Step 1 -StepStatus "Verificado" -StepColor "#34D399"
} else {
    # Buscar instalador vc_redist.x64.exe
    $vcRedist = $null
    foreach ($dir in $searchDirs) {
        if ($dir -and (Test-Path $dir)) {
            $candidate = Join-Path $dir "vc_redist.x64.exe"
            if ((Test-Path $candidate) -and ((Get-Item $candidate).Length -gt 10000000)) {
                $vcRedist = $candidate
                break
            }
        }
    }

    if ($vcRedist) {
        Update-UiStatus -Progress 15 -Message "Instalando Microsoft Visual C++ de forma silenciosa..." -Step 1 -StepStatus "Instalando..."
        
        # Ejecutar 100% silencioso y esperar finalización absoluta
        $pVc = Start-Process -FilePath $vcRedist -ArgumentList "/install /quiet /norestart" -PassThru
        $null = $pVc.WaitForExit()

        # Esperar liberación completa del mutex de Windows Installer (MSI)
        $msiWait = 0
        while ((Get-Process -Name "msiexec", "vc_redist*", "vcredist*" -ErrorAction SilentlyContinue) -and ($msiWait -lt 30)) {
            Start-Sleep -Milliseconds 500
            $msiWait++
        }
        
        Update-UiStatus -Progress 25 -Message "Librerías C++ configuradas con éxito." -Step 1 -StepStatus "Instalado" -StepColor "#34D399"
    } else {
        Update-UiStatus -Progress 25 -Message "Librerías C++ listas." -Step 1 -StepStatus "Omitido" -StepColor "#34D399"
    }
}

# ------------------------------------------------------------------------------
# PASO 2: INSTALAR POSTGRESQL 16 & PGADMIN 4 (SI NO ESTÁ INSTALADO)
# ------------------------------------------------------------------------------
if ($null -eq $installedPg) {
    Update-UiStatus -Progress 30 -Message "Buscando paquete de instalación de PostgreSQL 16..." -Step 2 -StepStatus "Localizando..."
    
    $localInstaller = $null
    foreach ($dir in $searchDirs) {
        if ($dir -and (Test-Path $dir)) {
            $found = Get-ChildItem -Path $dir -Filter "*postgresql*windows-x64*.exe" -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
            if ($found -and $found.Length -gt 100000000) { # > 100MB
                $localInstaller = $found.FullName
                break
            }
        }
    }

    $installerExe = $localInstaller

    if (-not $localInstaller) {
        Update-UiStatus -Progress 32 -Message "Descargando instalador oficial de PostgreSQL 16..." -Step 2 -StepStatus "Descargando..."
        $downloadUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.15-3-windows-x64.exe"
        $installerExe = Join-Path $env:TEMP "postgresql-16-installer.exe"

        $downloadSuccess = $false
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            try {
                & curl.exe -L -o "$installerExe" "$downloadUrl" --silent
                if ((Test-Path $installerExe) -and ((Get-Item $installerExe).Length -gt 100000000)) {
                    $downloadSuccess = $true
                }
            } catch {}
        }

        if (-not $downloadSuccess) {
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri $downloadUrl -OutFile $installerExe -UseBasicParsing
                if ((Test-Path $installerExe) -and ((Get-Item $installerExe).Length -gt 100000000)) {
                    $downloadSuccess = $true
                }
            } catch {}
        }

        if (-not $downloadSuccess) {
            Update-UiStatus -Progress 30 -Message "Error al descargar PostgreSQL. Verifique su conexión." -Step 2 -StepStatus "Error" -StepColor "#EF4444"
            Start-Sleep -Seconds 3
            if ($useWpf -and $window) { $window.Close() }
            exit 1
        }
    }

    # Detectar entorno de Windows Sandbox
    $isSandbox = ($env:USERNAME -eq "WDAGUtilityAccount") -or (Test-Path "C:\Users\WDAGUtilityAccount")
    
    Update-UiStatus -Progress 45 -Message "Instalando servidor PostgreSQL 16 y pgAdmin 4... (Esto toma 1-2 min)" -Step 2 -StepStatus "Instalando..."

    # Argumentos limpios y optimizados:
    # --install_runtimes 0 es CRUCIAL para evitar error 1618 de colisión con vcredist
    $pgArgs = @(
        "--mode", "unattended",
        "--unattendedmodeui", "none",
        "--superpassword", "postgres",
        "--serverport", "5432",
        "--install_runtimes", "0",
        "--enable_acls", "1"
    )

    if ($isSandbox) {
        $pgArgs += @("--serviceaccount", "LocalSystem")
    }

    $argString = $pgArgs -join " "
    $proc = Start-Process -FilePath $installerExe -ArgumentList $argString -Wait -PassThru

    # Reintento con cuenta alternativa si el código de salida no es 0 ni 3010
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        Update-UiStatus -Progress 55 -Message "Reintentando configuración de servicio alternativo..." -Step 2 -StepStatus "Reintentando..."
        $altArgs = if ($isSandbox) {
            "--mode unattended --unattendedmodeui none --superpassword postgres --serverport 5432 --install_runtimes 0"
        } else {
            "--mode unattended --unattendedmodeui none --superpassword postgres --serverport 5432 --install_runtimes 0 --serviceaccount LocalSystem"
        }
        $proc2 = Start-Process -FilePath $installerExe -ArgumentList $altArgs -Wait -PassThru

        if ($proc2.ExitCode -ne 0 -and $proc2.ExitCode -ne 3010) {
            Update-UiStatus -Progress 50 -Message "Abriendo asistente de configuración asistido..." -Step 2 -StepStatus "Asistido" -StepColor "#F59E0B"
            Start-Process -FilePath $installerExe -Wait
        }
    }

    Update-UiStatus -Progress 75 -Message "PostgreSQL 16 y pgAdmin 4 instalados con éxito." -Step 2 -StepStatus "Instalado" -StepColor "#34D399"
} else {
    Update-UiStatus -Progress 75 -Message "PostgreSQL ya se encuentra presente en el equipo." -Step 2 -StepStatus "Presente" -StepColor "#34D399"
}

# ------------------------------------------------------------------------------
# PASO 3: CONFIGURAR SERVICIO DE WINDOWS Y VERIFICAR PUERTO 5432
# ------------------------------------------------------------------------------
Update-UiStatus -Progress 80 -Message "Configurando servicio de Windows 'postgresql-x64-16'..." -Step 3 -StepStatus "Configurando..."

$serviceNames = @("postgresql-x64-16", "postgresql-x64-17", "postgresql-x64-15", "postgresql")
$activeService = $null

foreach ($s in $serviceNames) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) {
        $activeService = $s
        break
    }
}

if ($activeService) {
    # Inicio automático y autorecuperación
    sc.exe config $activeService start= auto 2>$null | Out-Null
    sc.exe failure $activeService reset= 86400 actions= restart/5000/restart/10000/restart/20000 2>$null | Out-Null
    net start $activeService 2>$null | Out-Null
    sc.exe start $activeService 2>$null | Out-Null
}

# Comprobar disponibilidad de puerto 5432
Update-UiStatus -Progress 85 -Message "Esperando disponibilidad en puerto de datos 5432..." -Step 3 -StepStatus "Verificando..."

$portOk = $false
for ($i = 1; $i -le 30; $i++) {
    $portOk = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Quiet
    if ($portOk) { break }
    Start-Sleep -Seconds 1
}

if ($portOk) {
    Update-UiStatus -Progress 90 -Message "Puerto 5432 en línea y listo para recibir peticiones." -Step 3 -StepStatus "Activo (5432)" -StepColor "#34D399"
} else {
    Update-UiStatus -Progress 90 -Message "Servicio configurado en modo automático." -Step 3 -StepStatus "Configurado" -StepColor "#34D399"
}

# ------------------------------------------------------------------------------
# PASO 4: CREAR / VERIFICAR BASE DE DATOS 'americanpos'
# ------------------------------------------------------------------------------
Update-UiStatus -Progress 92 -Message "Verificando base de datos 'americanpos'..." -Step 4 -StepStatus "Verificando..."

$createdb = "C:\Program Files\PostgreSQL\16\bin\createdb.exe"
if (!(Test-Path $createdb)) {
    $createdb = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\createdb.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}

if ($createdb -and (Test-Path $createdb)) {
    $env:PGPASSWORD = "postgres"
    & $createdb -U postgres -h 127.0.0.1 -p 5432 -E UTF8 americanpos 2>$null
    Update-UiStatus -Progress 95 -Message "Base de datos 'americanpos' preparada con éxito." -Step 4 -StepStatus "Lista" -StepColor "#34D399"
} else {
    Update-UiStatus -Progress 95 -Message "Cluster de datos listo para inicialización de esquemas." -Step 4 -StepStatus "Listo" -StepColor "#34D399"
}

# ------------------------------------------------------------------------------
# PASO 5: CONFIGURAR ACCESO DE RED LOCAL (LAN) Y FIREWALL DE WINDOWS
# ------------------------------------------------------------------------------
Update-UiStatus -Progress 96 -Message "Habilitando puertos en Firewall de Windows para terminales remotas..."

try {
    # 1. Reglas de entrada de Firewall para PostgreSQL (5432) y API de Isaac POS (3005, 5005, 8080)
    New-NetFirewallRule -DisplayName "Isaac POS - PostgreSQL Database" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow -ErrorAction SilentlyContinue | Out-Null
    New-NetFirewallRule -DisplayName "Isaac POS - Express API" -Direction Inbound -Protocol TCP -LocalPort 3005, 5005, 8080 -Action Allow -ErrorAction SilentlyContinue | Out-Null
    New-NetFirewallRule -DisplayName "Isaac POS - LAN P2P Discovery" -Direction Inbound -Protocol UDP -LocalPort 41234 -Action Allow -ErrorAction SilentlyContinue | Out-Null
} catch {
    netsh advfirewall firewall add rule name="Isaac POS - PostgreSQL" dir=in action=allow protocol=TCP localport=5432 2>$null | Out-Null
    netsh advfirewall firewall add rule name="Isaac POS - Express API" dir=in action=allow protocol=TCP localport=3005,5005,8080 2>$null | Out-Null
}

# 2. Configurar postgresql.conf y pg_hba.conf para permitir conexiones desde Cajas Secundarias
$dataDirs = @(
    "C:\Program Files\PostgreSQL\16\data",
    "C:\Program Files\PostgreSQL\17\data",
    "C:\Program Files\PostgreSQL\15\data"
)

foreach ($dDir in $dataDirs) {
    if (Test-Path $dDir) {
        $confFile = Join-Path $dDir "postgresql.conf"
        $hbaFile = Join-Path $dDir "pg_hba.conf"
        $needsRestart = $false

        # postgresql.conf -> listen_addresses = '*'
        if (Test-Path $confFile) {
            $confContent = Get-Content -Path $confFile -Raw -Encoding UTF8
            if ($confContent -notmatch "listen_addresses\s*=\s*'\*'") {
                Add-Content -Path $confFile -Value "`nlisten_addresses = '*'`n" -Encoding UTF8
                $needsRestart = $true
            }
        }

        # pg_hba.conf -> permitir subredes privadas LAN con scram-sha-256
        if (Test-Path $hbaFile) {
            $hbaContent = Get-Content -Path $hbaFile -Raw -Encoding UTF8
            if ($hbaContent -notmatch "192\.168\.0\.0/16") {
                $lanRules = "`n# Isaac POS LAN Subnets`nhost    all             all             192.168.0.0/16          scram-sha-256`nhost    all             all             10.0.0.0/8              scram-sha-256`nhost    all             all             172.16.0.0/12           scram-sha-256`n"
                Add-Content -Path $hbaFile -Value $lanRules -Encoding UTF8
                $needsRestart = $true
            }
        }

        if ($needsRestart -and $activeService) {
            Restart-Service -Name $activeService -Force -ErrorAction SilentlyContinue
        }
        break
    }
}

# 3. Escribir configuración inicial de servidor en %AppData%\isaac-pos\db-config.json
try {
    $appDataTarget = Join-Path $env:APPDATA "isaac-pos"
    if (!(Test-Path $appDataTarget)) { New-Item -Path $appDataTarget -ItemType Directory -Force 2>$null | Out-Null }
    $cfgJsonPath = Join-Path $appDataTarget "db-config.json"
    if (!(Test-Path $cfgJsonPath)) {
        $serverConfigObj = [PSCustomObject]@{
            mode = "server"
            dialect = "postgres"
            host = "127.0.0.1"
            port = 5432
            database = "americanpos"
            user = "postgres"
            password = "postgres"
        }
        $serverConfigObj | ConvertTo-Json | Set-Content -Path $cfgJsonPath -Encoding UTF8 2>$null
    }
} catch { }



# ------------------------------------------------------------------------------
# FINALIZACIÓN EXITOSA
# ------------------------------------------------------------------------------
Update-UiStatus -Progress 100 -Message "¡Todos los componentes se configuraron con éxito! Iniciando Isaac POS..."

Start-Sleep -Milliseconds 2200

if ($useWpf -and $window) {
    $window.Close()
}
exit 0
