using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Isaac POS Ultra Enterprise Setup")]
[assembly: AssemblyDescription("Instalador Oficial de Isaac POS Ultra Enterprise")]
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCompany("Isaac POS Team")]
[assembly: AssemblyProduct("Isaac POS Ultra")]
[assembly: AssemblyCopyright("Copyright © 2026 Isaac POS Team")]
[assembly: AssemblyTrademark("Isaac POS")]
[assembly: AssemblyCulture("")]
[assembly: AssemblyVersion("24.4.0.0")]
[assembly: AssemblyFileVersion("24.4.0.0")]

namespace IsaacPOS.Installer {
    public class InstallerForm : Form {
        private Label lblHeaderTitle;
        private Label lblHeaderSubtitle;
        private Label lblDest;
        private TextBox txtDest;
        private Button btnBrowse;
        private CheckBox chkDesktop;
        private CheckBox chkStartMenu;
        private CheckBox chkAutoStart;
        private CheckBox chkPostgres;
        private CheckBox chkLaunchAfter;
        private ProgressBar pbar;
        private Label lblStatus;
        private TextBox txtLogs;
        private Button btnInstall;
        private Button btnCancel;
        private BackgroundWorker worker;
        private bool isFinished = false;

        public InstallerForm() {
            InitializeComponents();
        }

        private void InitializeComponents() {
            this.Text = "Isaac POS Ultra - Instalador Oficial Enterprise v24.04.0";
            this.Size = new Size(680, 560);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42); // Slate 900
            this.ForeColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            // Header Panel
            Panel pnlHeader = new Panel();
            pnlHeader.Dock = DockStyle.Top;
            pnlHeader.Height = 85;
            pnlHeader.BackColor = Color.FromArgb(30, 41, 59); // Slate 800
            pnlHeader.Padding = new Padding(20, 15, 20, 10);

            lblHeaderTitle = new Label();
            lblHeaderTitle.Text = "ISAAC POS ULTRA ENTERPRISE";
            lblHeaderTitle.Font = new Font("Segoe UI", 16F, FontStyle.Bold);
            lblHeaderTitle.ForeColor = Color.FromArgb(96, 165, 250); // Blue 400
            lblHeaderTitle.AutoSize = true;
            lblHeaderTitle.Location = new Point(20, 12);
            pnlHeader.Controls.Add(lblHeaderTitle);

            lblHeaderSubtitle = new Label();
            lblHeaderSubtitle.Text = "Versión 24.04.0 | Motor PostgreSQL 16 Certificado | Multi-Impresora";
            lblHeaderSubtitle.Font = new Font("Segoe UI", 9.5F, FontStyle.Regular);
            lblHeaderSubtitle.ForeColor = Color.FromArgb(148, 163, 184); // Slate 400
            lblHeaderSubtitle.AutoSize = true;
            lblHeaderSubtitle.Location = new Point(22, 45);
            pnlHeader.Controls.Add(lblHeaderSubtitle);

            this.Controls.Add(pnlHeader);

            // Destination directory
            lblDest = new Label();
            lblDest.Text = "Directorio de Instalación:";
            lblDest.Location = new Point(25, 105);
            lblDest.AutoSize = true;
            lblDest.ForeColor = Color.FromArgb(226, 232, 240);
            this.Controls.Add(lblDest);

            string defaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Isaac POS");
            txtDest = new TextBox();
            txtDest.Text = defaultDir;
            txtDest.Location = new Point(25, 130);
            txtDest.Width = 500;
            txtDest.BackColor = Color.FromArgb(30, 41, 59);
            txtDest.ForeColor = Color.White;
            txtDest.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtDest);

            btnBrowse = new Button();
            btnBrowse.Text = "Examinar...";
            btnBrowse.Location = new Point(535, 128);
            btnBrowse.Width = 100;
            btnBrowse.Height = 26;
            btnBrowse.BackColor = Color.FromArgb(51, 65, 85);
            btnBrowse.ForeColor = Color.White;
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.FlatAppearance.BorderSize = 0;
            btnBrowse.Click += delegate {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {
                    fbd.SelectedPath = txtDest.Text;
                    if (fbd.ShowDialog() == DialogResult.OK) {
                        txtDest.Text = fbd.SelectedPath;
                    }
                }
            };
            this.Controls.Add(btnBrowse);

            // Checkboxes
            chkDesktop = new CheckBox();
            chkDesktop.Text = "Crear acceso directo en el Escritorio";
            chkDesktop.Checked = true;
            chkDesktop.Location = new Point(25, 168);
            chkDesktop.AutoSize = true;
            this.Controls.Add(chkDesktop);

            chkStartMenu = new CheckBox();
            chkStartMenu.Text = "Crear acceso directo en el Menú Inicio";
            chkStartMenu.Checked = true;
            chkStartMenu.Location = new Point(25, 193);
            chkStartMenu.AutoSize = true;
            this.Controls.Add(chkStartMenu);

            chkAutoStart = new CheckBox();
            chkAutoStart.Text = "Iniciar automáticamente al encender Windows";
            chkAutoStart.Checked = true;
            chkAutoStart.Location = new Point(320, 168);
            chkAutoStart.AutoSize = true;
            this.Controls.Add(chkAutoStart);

            chkPostgres = new CheckBox();
            chkPostgres.Text = "Verificar / Iniciar servicio PostgreSQL 16";
            chkPostgres.Checked = true;
            chkPostgres.Location = new Point(320, 193);
            chkPostgres.AutoSize = true;
            this.Controls.Add(chkPostgres);

            chkLaunchAfter = new CheckBox();
            chkLaunchAfter.Text = "Abrir Isaac POS Ultra al finalizar la instalación";
            chkLaunchAfter.Checked = true;
            chkLaunchAfter.Location = new Point(25, 220);
            chkLaunchAfter.AutoSize = true;
            chkLaunchAfter.ForeColor = Color.FromArgb(52, 211, 153); // Emerald 400
            this.Controls.Add(chkLaunchAfter);

            // Progress Bar
            pbar = new ProgressBar();
            pbar.Location = new Point(25, 255);
            pbar.Width = 610;
            pbar.Height = 22;
            pbar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(pbar);

            lblStatus = new Label();
            lblStatus.Text = "Listo para iniciar la instalación.";
            lblStatus.Location = new Point(25, 283);
            lblStatus.Width = 610;
            lblStatus.ForeColor = Color.FromArgb(148, 163, 184);
            this.Controls.Add(lblStatus);

            // Logs Box
            txtLogs = new TextBox();
            txtLogs.Location = new Point(25, 308);
            txtLogs.Width = 610;
            txtLogs.Height = 135;
            txtLogs.Multiline = true;
            txtLogs.ReadOnly = true;
            txtLogs.ScrollBars = ScrollBars.Vertical;
            txtLogs.BackColor = Color.FromArgb(10, 15, 29);
            txtLogs.ForeColor = Color.FromArgb(56, 189, 248); // Sky blue
            txtLogs.Font = new Font("Consolas", 8.5F);
            txtLogs.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtLogs);

            // Buttons
            btnInstall = new Button();
            btnInstall.Text = "INSTALAR AHORA";
            btnInstall.Location = new Point(350, 460);
            btnInstall.Width = 160;
            btnInstall.Height = 42;
            btnInstall.BackColor = Color.FromArgb(37, 99, 235); // Blue 600
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
            btnInstall.Click += BtnInstall_Click;
            this.Controls.Add(btnInstall);

            btnCancel = new Button();
            btnCancel.Text = "Cancelar";
            btnCancel.Location = new Point(525, 460);
            btnCancel.Width = 110;
            btnCancel.Height = 42;
            btnCancel.BackColor = Color.FromArgb(51, 65, 85);
            btnCancel.ForeColor = Color.White;
            btnCancel.FlatStyle = FlatStyle.Flat;
            btnCancel.FlatAppearance.BorderSize = 0;
            btnCancel.Click += delegate {
                if (isFinished) {
                    this.Close();
                } else {
                    if (MessageBox.Show("¿Está seguro de que desea salir del instalador?", "Confirmar Salida", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes) {
                        this.Close();
                    }
                }
            };
            this.Controls.Add(btnCancel);

            worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Worker_DoWork;
            worker.ProgressChanged += Worker_ProgressChanged;
            worker.RunWorkerCompleted += Worker_RunWorkerCompleted;
        }

        private void AppendLog(string message) {
            if (txtLogs.InvokeRequired) {
                txtLogs.Invoke(new Action<string>(AppendLog), message);
                return;
            }
            txtLogs.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message + Environment.NewLine);
        }

        private void BtnInstall_Click(object sender, EventArgs e) {
            if (isFinished) {
                this.Close();
                return;
            }

            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtDest.Enabled = false;
            chkDesktop.Enabled = false;
            chkStartMenu.Enabled = false;
            chkAutoStart.Enabled = false;
            chkPostgres.Enabled = false;
            chkLaunchAfter.Enabled = false;

            lblStatus.Text = "Iniciando instalación...";
            worker.RunWorkerAsync(txtDest.Text.Trim());
        }

        private void Worker_DoWork(object sender, DoWorkEventArgs e) {
            string installDir = (string)e.Argument;

            // 1. Cerrar procesos previos
            worker.ReportProgress(5, "Cerrando instancias previas de Isaac POS...");
            try {
                foreach (var p in Process.GetProcessesByName("Isaac POS")) {
                    try { p.Kill(); p.WaitForExit(2000); } catch { }
                }
                foreach (var p in Process.GetProcessesByName("American POS")) {
                    try { p.Kill(); p.WaitForExit(2000); } catch { }
                }
            } catch { }

            // 2. Preparar directorio
            worker.ReportProgress(10, "Creando carpeta de destino: " + installDir);
            if (!Directory.Exists(installDir)) {
                Directory.CreateDirectory(installDir);
            }

            // 3. Extraer payload incrustado
            string currentExe = Assembly.GetExecutingAssembly().Location;
            worker.ReportProgress(15, "Leyendo archivo maestro de instalación...");

            using (FileStream fs = new FileStream(currentExe, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                fs.Seek(-8, SeekOrigin.End);
                byte[] lenBytes = new byte[8];
                fs.Read(lenBytes, 0, 8);
                long payloadLen = BitConverter.ToInt64(lenBytes, 0);

                if (payloadLen <= 0 || payloadLen >= fs.Length) {
                    throw new Exception("No se encontró el paquete incrustado de la aplicación en el ejecutable.");
                }

                long payloadStart = fs.Length - 8 - payloadLen;
                fs.Seek(payloadStart, SeekOrigin.Begin);

                string fullInstallRoot = Path.GetFullPath(installDir);
                if (!fullInstallRoot.EndsWith(Path.DirectorySeparatorChar.ToString())) {
                    fullInstallRoot += Path.DirectorySeparatorChar;
                }

                using (ZipArchive archive = new ZipArchive(fs, ZipArchiveMode.Read, true)) {
                    int total = archive.Entries.Count;
                    worker.ReportProgress(20, string.Format("Descomprimiendo {0} archivos del sistema...", total));

                    for (int i = 0; i < total; i++) {
                        ZipArchiveEntry entry = archive.Entries[i];
                        string destFilePath = Path.GetFullPath(Path.Combine(fullInstallRoot, entry.FullName));
                        if (!destFilePath.StartsWith(fullInstallRoot, StringComparison.OrdinalIgnoreCase)) {
                            throw new UnauthorizedAccessException("Entrada ZIP inválida detectada (Zip-Slip): " + entry.FullName);
                        }

                        if (string.IsNullOrEmpty(entry.Name)) {
                            // Directory
                            if (!Directory.Exists(destFilePath)) Directory.CreateDirectory(destFilePath);
                            continue;
                        }

                        string parent = Path.GetDirectoryName(destFilePath);
                        if (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent)) Directory.CreateDirectory(parent);

                        try {
                            entry.ExtractToFile(destFilePath, true);
                        } catch (IOException ioEx) {
                            // Tolerar únicamente archivo bloqueado en uso; propagar errores de integridad o permisos
                            worker.ReportProgress(20 + (int)((i / (double)total) * 60), "Archivo en uso omitido: " + entry.Name + " (" + ioEx.Message + ")");
                        }

                        if (i % 250 == 0 || i == total - 1) {
                            int pct = 20 + (int)((i / (double)total) * 60);
                            worker.ReportProgress(pct, string.Format("Extrayendo ({0}/{1}): {2}", i + 1, total, entry.Name));
                        }
                    }
                }
            }

            worker.ReportProgress(82, "Extracción de archivos completada exitosamente.");

            // 4. Configurar PostgreSQL
            if (chkPostgres.Checked) {
                worker.ReportProgress(85, "Verificando servicio de base de datos PostgreSQL...");
                try {
                    ProcessStartInfo psi = new ProcessStartInfo("sc.exe", "config postgresql-x64-16 start= auto");
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    Process pConfig = Process.Start(psi);
                    if (pConfig != null) pConfig.WaitForExit(3000);

                    ProcessStartInfo psiStart = new ProcessStartInfo("net.exe", "start postgresql-x64-16");
                    psiStart.CreateNoWindow = true;
                    psiStart.UseShellExecute = false;
                    Process pStart = Process.Start(psiStart);
                    if (pStart != null) pStart.WaitForExit(4000);
                } catch { }
            }

            // 5. Crear accesos directos
            string exePath = Path.Combine(installDir, "Isaac POS.exe");
            if (File.Exists(exePath)) {
                try {
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                    if (shellType != null) {
                        dynamic wshell = Activator.CreateInstance(shellType);

                        if (chkDesktop.Checked) {
                            worker.ReportProgress(90, "Creando acceso directo en el Escritorio...");
                            string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                            string lnk = Path.Combine(desktopDir, "Isaac POS.lnk");
                            dynamic sc = wshell.CreateShortcut(lnk);
                            sc.TargetPath = exePath;
                            sc.WorkingDirectory = installDir;
                            sc.IconLocation = exePath + ", 0";
                            sc.Save();
                        }

                        if (chkStartMenu.Checked) {
                            worker.ReportProgress(93, "Creando acceso directo en Menú Inicio...");
                            string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Isaac POS");
                            if (!Directory.Exists(startMenu)) Directory.CreateDirectory(startMenu);
                            string lnk = Path.Combine(startMenu, "Isaac POS.lnk");
                            dynamic sc = wshell.CreateShortcut(lnk);
                            sc.TargetPath = exePath;
                            sc.WorkingDirectory = installDir;
                            sc.IconLocation = exePath + ", 0";
                            sc.Save();
                        }

                        if (chkAutoStart.Checked) {
                            worker.ReportProgress(95, "Configurando inicio automático con Windows...");
                            try {
                                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                                    if (key != null) {
                                        key.SetValue("Isaac POS", "\"" + exePath + "\"");
                                    }
                                }
                            } catch { }
                        }
                    }
                } catch (Exception ex) {
                    worker.ReportProgress(96, "Nota sobre accesos directos: " + ex.Message);
                }

                // 6. Registro de Desinstalación en Windows
                try {
                    using (RegistryKey ukey = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\IsaacPOSUltra")) {
                        if (ukey != null) {
                            ukey.SetValue("DisplayName", "Isaac POS Ultra Enterprise");
                            ukey.SetValue("DisplayVersion", "24.04.0");
                            ukey.SetValue("Publisher", "Isaac POS Team");
                            ukey.SetValue("InstallLocation", installDir);
                            ukey.SetValue("DisplayIcon", exePath + ",0");
                            string uninst = Path.Combine(installDir, "Uninstall.exe");
                            ukey.SetValue("UninstallString", File.Exists(uninst) ? uninst : exePath);
                        }
                    }
                } catch { }
            }

            worker.ReportProgress(100, "¡INSTALACIÓN COMPLETADA EXITOSAMENTE!");
            e.Result = installDir;
        }

        private void Worker_ProgressChanged(object sender, ProgressChangedEventArgs e) {
            pbar.Value = Math.Min(100, Math.Max(0, e.ProgressPercentage));
            string msg = (string)e.UserState;
            lblStatus.Text = msg;
            AppendLog(msg);
        }

        private void Worker_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e) {
            if (e.Error != null) {
                lblStatus.Text = "Error durante la instalación.";
                lblStatus.ForeColor = Color.FromArgb(239, 68, 68); // Red 500
                AppendLog("ERROR CRÍTICO: " + e.Error.Message);
                MessageBox.Show("Ocurrió un error durante la instalación:\n" + e.Error.Message, "Error de Instalación", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
                btnInstall.Text = "REINTENTAR";
                return;
            }

            isFinished = true;
            btnInstall.Enabled = true;
            btnInstall.Text = "FINALIZAR";
            btnInstall.BackColor = Color.FromArgb(16, 185, 129); // Emerald 500
            btnCancel.Visible = false;

            lblStatus.Text = "¡Instalación 100% Exitosa! Ya puedes usar Isaac POS Ultra.";
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153); // Emerald 400

            string installDir = (string)e.Result;
            string exePath = Path.Combine(installDir, "Isaac POS.exe");

            if (chkLaunchAfter.Checked && File.Exists(exePath)) {
                try {
                    ProcessStartInfo psi = new ProcessStartInfo(exePath);
                    psi.WorkingDirectory = installDir;
                    Process.Start(psi);
                } catch { }
            }
        }

        [STAThread]
        public static int Main() {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
            return 0;
        }
    }
}
