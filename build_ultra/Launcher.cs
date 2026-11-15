using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace IsaacPOS
{
    public class SplashForm : Form
    {
        private Label lblStatus;
        private ProgressBar progressBar;

        public SplashForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(420, 210);
            this.BackColor = Color.FromArgb(7, 11, 25); // #070b19 dark navy
            this.ShowInTaskbar = true;
            this.TopMost = true;
            this.DoubleBuffered = true;

            // Borde exterior moderno con acento superior azul
            this.Paint += (s, e) =>
            {
                using (Pen p = new Pen(Color.FromArgb(30, 41, 59), 2)) // #1e293b
                {
                    e.Graphics.DrawRectangle(p, 1, 1, this.Width - 2, this.Height - 2);
                }
                using (Pen pAcc = new Pen(Color.FromArgb(37, 99, 235), 3)) // #2563eb top accent bar
                {
                    e.Graphics.DrawLine(pAcc, 0, 1, this.Width, 1);
                }
            };

            // Título Principal
            Label lblTitle = new Label();
            lblTitle.Text = "Isaac POS";
            lblTitle.Font = new Font("Segoe UI", 18, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(28, 24);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);

            // Badge "ULTRA"
            Label lblBadge = new Label();
            lblBadge.Text = " ULTRA ";
            lblBadge.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            lblBadge.ForeColor = Color.FromArgb(56, 189, 248); // sky-400
            lblBadge.BackColor = Color.FromArgb(12, 74, 110); // sky-950
            lblBadge.Location = new Point(168, 30);
            lblBadge.AutoSize = true;
            this.Controls.Add(lblBadge);

            // Subtítulo
            Label lblSubtitle = new Label();
            lblSubtitle.Text = "Sistema de Facturación e Inventario • Edición Windows";
            lblSubtitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblSubtitle.ForeColor = Color.FromArgb(148, 163, 184); // slate-400
            lblSubtitle.Location = new Point(30, 60);
            lblSubtitle.AutoSize = true;
            this.Controls.Add(lblSubtitle);

            // Etiqueta de estado de arranque en tiempo real
            lblStatus = new Label();
            lblStatus.Text = "Iniciando motor de ventas y base de datos...";
            lblStatus.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblStatus.ForeColor = Color.FromArgb(226, 232, 240); // slate-200
            lblStatus.Location = new Point(30, 108);
            lblStatus.Size = new Size(360, 22);
            this.Controls.Add(lblStatus);

            // Barra de progreso continua
            progressBar = new ProgressBar();
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.MarqueeAnimationSpeed = 25;
            progressBar.Location = new Point(30, 138);
            progressBar.Size = new Size(360, 7);
            this.Controls.Add(progressBar);

            // Pie de página sutil
            Label lblFooter = new Label();
            lblFooter.Text = "Verificando conexión con el servidor...";
            lblFooter.Font = new Font("Segoe UI", 7.5f, FontStyle.Regular);
            lblFooter.ForeColor = Color.FromArgb(100, 116, 139); // slate-500
            lblFooter.Location = new Point(30, 168);
            lblFooter.AutoSize = true;
            this.Controls.Add(lblFooter);
        }

        public void UpdateStatus(string message)
        {
            if (this.IsDisposed || !this.IsHandleCreated) return;
            try
            {
                if (this.InvokeRequired)
                {
                    this.BeginInvoke(new Action<string>(UpdateStatus), message);
                    return;
                }
                lblStatus.Text = message;
            }
            catch { }
        }
    }

    static class Program
    {
        private const string AppMutexName = "IsaacPOS_Windows_Ultra_App_Lock";
        private const int DefaultPort = 3005;
        private const int SW_RESTORE = 9;

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        private static IntPtr foundWindowHandle = IntPtr.Zero;

        static bool TryFocusExistingWindow()
        {
            foundWindowHandle = IntPtr.Zero;
            try
            {
                EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
                {
                    if (IsWindowVisible(hWnd))
                    {
                        StringBuilder sb = new StringBuilder(256);
                        GetWindowText(hWnd, sb, 256);
                        string title = sb.ToString();
                        if (!string.IsNullOrEmpty(title) && title.IndexOf("Isaac POS", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            // Ignorar ventanas de navegadores generales con pestañas abiertas
                            if (title.IndexOf("Google Chrome", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Mozilla Firefox", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Brave", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Microsoft Edge", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                return true;
                            }
                            foundWindowHandle = hWnd;
                            return false; // Detener búsqueda
                        }
                    }
                    return true;
                }, IntPtr.Zero);

                if (foundWindowHandle != IntPtr.Zero)
                {
                    ShowWindow(foundWindowHandle, SW_RESTORE);
                    SetForegroundWindow(foundWindowHandle);
                    return true;
                }
            }
            catch
            {
                // Fallback silencioso
            }
            return false;
        }

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool isOnlyInstance = false;
            Mutex mutex = null;
            try
            {
                mutex = new Mutex(true, AppMutexName, out isOnlyInstance);
            }
            catch (AbandonedMutexException)
            {
                isOnlyInstance = true;
            }
            catch
            {
                isOnlyInstance = true;
            }

            if (!isOnlyInstance)
            {
                TryFocusExistingWindow();
                return;
            }

            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string nodeExe = Path.Combine(baseDir, "node.exe");
                if (!File.Exists(nodeExe))
                {
                    nodeExe = "node.exe";
                }

                string indexJs = Path.Combine(baseDir, "index.js");

                // Si el servidor YA está respondiendo (ej. reinicio rápido del POS con backend ya en memoria)
                if (IsServerResponsive(DefaultPort))
                {
                    if (TryFocusExistingWindow()) return;
                    LaunchEdgeAppMode(DefaultPort);
                    return;
                }

                // Si el servidor NO está activo, mostramos la pantalla de carga (Splash) con Handshake Garantizado
                SplashForm splash = new SplashForm();

                Thread workerThread = new Thread(() =>
                {
                    try
                    {
                        if (File.Exists(indexJs))
                        {
                            splash.UpdateStatus("Iniciando servicios del sistema...");
                            StartBackendServer(nodeExe, indexJs, baseDir);

                            // Sondeo activo hasta que devuelva HTTP 200 con timeout tolerante (hasta 35 segundos)
                            bool serverReady = false;
                            for (int i = 0; i < 115; i++)
                            {
                                Thread.Sleep(300);

                                if (i == 4) splash.UpdateStatus("Iniciando motor de base de datos...");
                                if (i == 14) splash.UpdateStatus("Cargando módulos y configuración...");
                                if (i == 25) splash.UpdateStatus("Verificando servicios y red local...");

                                if (IsServerResponsive(DefaultPort))
                                {
                                    serverReady = true;
                                    break;
                                }
                            }

                            if (serverReady)
                            {
                                splash.UpdateStatus("¡Servidor listo! Abriendo terminal de ventas...");
                            }
                            else
                            {
                                splash.UpdateStatus("Abriendo terminal de ventas...");
                            }
                        }

                        Thread.Sleep(350);

                        splash.BeginInvoke(new Action(() =>
                        {
                            try
                            {
                                splash.Close();
                                LaunchEdgeAppMode(DefaultPort);
                            }
                            catch { }
                        }));
                    }
                    catch
                    {
                        try
                        {
                            splash.BeginInvoke(new Action(() =>
                            {
                                splash.Close();
                                LaunchEdgeAppMode(DefaultPort);
                            }));
                        }
                        catch { }
                    }
                });

                workerThread.IsBackground = true;
                workerThread.Start();

                Application.Run(splash);
                Thread.Sleep(1000);
            }
            finally
            {
                if (mutex != null)
                {
                    try { mutex.ReleaseMutex(); } catch { }
                    try { mutex.Dispose(); } catch { }
                }
            }
        }

        static bool IsServerResponsive(int port)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/hello");
                request.Timeout = 2000; // 2 segundos para tolerar picos de CPU en arranque
                request.Method = "GET";
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static void StartBackendServer(string nodeExe, string indexJs, string workingDir)
        {
            // 1. Iniciar servicio PostgreSQL si está presente
            try
            {
                string sysDir = Environment.GetFolderPath(Environment.SpecialFolder.System);
                string netExe = Path.Combine(sysDir, "net.exe");
                if (File.Exists(netExe))
                {
                    ProcessStartInfo pgPsi = new ProcessStartInfo(netExe, "start postgresql-x64-16");
                    pgPsi.UseShellExecute = false;
                    pgPsi.CreateNoWindow = true;
                    pgPsi.WindowStyle = ProcessWindowStyle.Hidden;
                    using (Process pgP = Process.Start(pgPsi))
                    {
                        if (pgP != null) pgP.WaitForExit(3000);
                    }
                }
            }
            catch { }

            // 2. Iniciar servidor Node.js
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = "\"" + indexJs + "\"";
                psi.WorkingDirectory = workingDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                // Inyección explícita de variables de entorno seguras
                psi.EnvironmentVariables["PORT"] = "3005,5005,8080";
                psi.EnvironmentVariables["JWT_SECRET"] = "4d0e0ed5b2e25fb26c0ce829cd8135a9e04c4eefdc881a2bb258d4aa98747ffe";
                psi.EnvironmentVariables["SYNC_SECRET_KEY"] = "AMERICAN_POS_SYNC_SECRET_KEY_2024";

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                try
                {
                    File.AppendAllText(Path.Combine(workingDir, "launcher_err.log"), DateTime.Now + ": " + ex.ToString() + Environment.NewLine);
                }
                catch { }
            }
        }

        static void LaunchEdgeAppMode(int port)
        {
            string url = "http://localhost:" + port + "/#/pos";
            
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (!File.Exists(edgePath))
            {
                edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
            }

            string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
            if (!File.Exists(chromePath))
            {
                chromePath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
            }

            string browserPath = File.Exists(edgePath) ? edgePath : (File.Exists(chromePath) ? chromePath : null);

            if (browserPath != null)
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = browserPath;
                psi.Arguments = "--app=\"" + url + "\" --window-size=1280,820 --kiosk-printing --no-first-run --no-default-browser-check --disable-features=CaretBrowsing";
                Process.Start(psi);
            }
            else
            {
                Process.Start(url);
            }
        }
    }
}
