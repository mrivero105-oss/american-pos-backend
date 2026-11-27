using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace IsaacPOS.Hardware {
    public class ReceiptLine {
        public string Text = "";
        public int Align = 0; // 0 = Left, 1 = Center, 2 = Right
        public bool Bold = false;
        public bool DoubleSize = false;
    }

    public class RawPrinter {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public class DOCINFOW {
            [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
            [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
        }

        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

        [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

        public static bool SendBytesToPrinter(string szPrinterName, byte[] lpBytes) {
            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOW di = new DOCINFOW();
            bool bSuccess = false;
            di.pDocName = "Isaac POS RAW Spool";
            di.pDataType = "RAW";

            if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
                if (StartDocPrinter(hPrinter, 1, di)) {
                    if (StartPagePrinter(hPrinter)) {
                        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(lpBytes.Length);
                        Marshal.Copy(lpBytes, 0, pUnmanagedBytes, lpBytes.Length);
                        Int32 dwWritten = 0;
                        bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, lpBytes.Length, out dwWritten);
                        EndPagePrinter(hPrinter);
                        Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    }
                    EndDocPrinter(hPrinter);
                }
                ClosePrinter(hPrinter);
            }
            return bSuccess;
        }

        public static bool IsGdiPagePrinter(string printerName) {
            if (string.IsNullOrEmpty(printerName)) return false;
            string n = printerName.ToLowerInvariant();

            string[] thermalKeywords = new string[] {
                "pos", "58", "80", "thermal", "termica", "térmica", "receipt", "ticket",
                "xprinter", "xp-", "tm-", "bixolon", "3nstar", "sat", "bematech",
                "citizen", "custom", "sewoo", "rongta", "gp-", "gprinter",
                "zjiang", "zj-", "generic", "text only"
            };
            foreach (string tk in thermalKeywords) {
                if (n.Contains(tk)) return false;
            }

            string[] pagePrinterKeywords = new string[] {
                "canon", "pixma", "maxify", "g10", "g20", "g30", "g40", "g50", "g60", "g70",
                "hp ", "hewlett", "deskjet", "laserjet", "officejet", "envy", "smart tank", "neverstop",
                "ecotank", "l11", "l12", "l31", "l32", "l35", "l41", "l42", "l51", "l52", "l61", "l62", "l80", "wf-", "workforce", "stylus",
                "brother", "dcp-", "mfc-", "hl-", "samsung", "xerox", "phaser", "versalink",
                "ricoh", "kyocera", "lexmark", "konica", "sharp", "ipp", "wsd"
            };
            foreach (string pk in pagePrinterKeywords) {
                if (n.Contains(pk)) return true;
            }

            return false;
        }

        private static string DecodeThermalBytes(byte[] rawBytes) {
            if (rawBytes == null || rawBytes.Length == 0) return "";
            try {
                // Primero intentar UTF-8 estricto; si hay secuencias ESC/POS en CP850/CP437/Win1252 lanzará DecoderFallbackException
                Encoding utf8Strict = new UTF8Encoding(false, true);
                return utf8Strict.GetString(rawBytes);
            } catch (DecoderFallbackException) {
                try {
                    return Encoding.GetEncoding(850).GetString(rawBytes);
                } catch {
                    return Encoding.GetEncoding(1252).GetString(rawBytes);
                }
            }
        }

        private static void CleanupStaleTempFiles() {
            try {
                string tempDir = Path.GetTempPath();
                DateTime threshold = DateTime.UtcNow.AddHours(-1);
                foreach (string file in Directory.GetFiles(tempDir, "isaac_gdi_*.bin")) {
                    try {
                        if (File.GetCreationTimeUtc(file) < threshold) {
                            File.Delete(file);
                        }
                    } catch { }
                }
            } catch { }
        }

        public static List<ReceiptLine> ParseEscPosToLines(byte[] bytes) {
            List<ReceiptLine> lines = new List<ReceiptLine>();
            if (bytes == null || bytes.Length == 0) return lines;

            int align = 0;
            bool bold = false;
            bool doubleSize = false;
            List<byte> currentLineBytes = new List<byte>();

            Action flushLine = () => {
                string text = DecodeThermalBytes(currentLineBytes.ToArray()).Replace("\r", "");
                ReceiptLine rl = new ReceiptLine();
                rl.Text = text;
                rl.Align = align;
                rl.Bold = bold;
                rl.DoubleSize = doubleSize;
                lines.Add(rl);
                currentLineBytes.Clear();
            };

            int i = 0;
            while (i < bytes.Length) {
                byte b = bytes[i];

                if (b == 0x10 && i + 2 < bytes.Length && bytes[i + 1] == 0x04) {
                    // DLE EOT n (status query)
                    i += 3;
                    continue;
                }

                if (b == 0x1B) { // ESC
                    if (i + 1 >= bytes.Length) { i++; continue; }
                    byte cmd = bytes[i + 1];
                    if (cmd == 0x40) { // ESC @ (Initialize)
                        align = 0;
                        bold = false;
                        doubleSize = false;
                        i += 2;
                        continue;
                    } else if (cmd == 0x61 && i + 2 < bytes.Length) { // ESC a n (Align)
                        if (currentLineBytes.Count > 0) flushLine();
                        byte n = bytes[i + 2];
                        if (n == 1 || n == (byte)'1') align = 1;
                        else if (n == 2 || n == (byte)'2') align = 2;
                        else align = 0;
                        i += 3;
                        continue;
                    } else if (cmd == 0x45 && i + 2 < bytes.Length) { // ESC E n (Bold)
                        byte n = bytes[i + 2];
                        bold = (n == 1 || n == (byte)'1');
                        i += 3;
                        continue;
                    } else if (cmd == 0x21 && i + 2 < bytes.Length) { // ESC ! n (Master style)
                        byte n = bytes[i + 2];
                        bold = (n & 0x08) != 0;
                        doubleSize = (n & 0x30) != 0;
                        i += 3;
                        continue;
                    } else if (cmd == 0x70 && i + 4 < bytes.Length) { // ESC p m t1 t2 (Cash Drawer Kick)
                        i += 5;
                        continue;
                    } else if ((cmd == 0x74 || cmd == 0x64 || cmd == 0x4D || cmd == 0x33 || cmd == 0x2D) && i + 2 < bytes.Length) {
                        i += 3;
                        continue;
                    } else {
                        i += 2;
                        continue;
                    }
                }

                if (b == 0x1D) { // GS
                    if (i + 1 >= bytes.Length) { i++; continue; }
                    byte cmd = bytes[i + 1];
                    if (cmd == 0x21 && i + 2 < bytes.Length) { // GS ! n (Character size)
                        byte n = bytes[i + 2];
                        doubleSize = (n != 0 && n != (byte)'0');
                        if (doubleSize) bold = true;
                        i += 3;
                        continue;
                    } else if (cmd == 0x56 && i + 2 < bytes.Length) { // GS V m [n] (Cut paper)
                        byte m = bytes[i + 2];
                        if ((m == 65 || m == 66) && i + 3 < bytes.Length) i += 4;
                        else i += 3;
                        continue;
                    } else if ((cmd == 0x68 || cmd == 0x77 || cmd == 0x48 || cmd == 0x66) && i + 2 < bytes.Length) { // Barcode params
                        i += 3;
                        continue;
                    } else if (cmd == 0x6B && i + 2 < bytes.Length) { // GS k m ... (Print barcode)
                        byte m = bytes[i + 2];
                        if (m <= 6) {
                            i += 3;
                            List<byte> bcBytes = new List<byte>();
                            while (i < bytes.Length && bytes[i] != 0x00) {
                                if (bytes[i] >= 0x20 && bytes[i] <= 0x7E) bcBytes.Add(bytes[i]);
                                i++;
                            }
                            if (i < bytes.Length && bytes[i] == 0x00) i++;
                            if (bcBytes.Count > 0) {
                                string bcText = Encoding.ASCII.GetString(bcBytes.ToArray());
                                ReceiptLine bcLine = new ReceiptLine();
                                bcLine.Text = "[ " + bcText + " ]";
                                bcLine.Align = 1;
                                bcLine.Bold = true;
                                lines.Add(bcLine);
                            }
                        } else if (i + 3 < bytes.Length) {
                            int len = bytes[i + 3];
                            i += 4;
                            List<byte> bcBytes = new List<byte>();
                            for (int k = 0; k < len && i < bytes.Length; k++, i++) {
                                if (bytes[i] >= 0x20 && bytes[i] <= 0x7E) bcBytes.Add(bytes[i]);
                            }
                            if (bcBytes.Count > 0) {
                                string bcText = Encoding.ASCII.GetString(bcBytes.ToArray());
                                ReceiptLine bcLine = new ReceiptLine();
                                bcLine.Text = "[ " + bcText + " ]";
                                bcLine.Align = 1;
                                bcLine.Bold = true;
                                lines.Add(bcLine);
                            }
                        } else {
                            i += 3;
                        }
                        continue;
                    } else {
                        i += 2;
                        continue;
                    }
                }

                if (b == 0x0A) { // \n
                    flushLine();
                    i++;
                    continue;
                }

                if (b == 0x0D) { // \r
                    i++;
                    continue;
                }

                if (b >= 0x20 || b == 0x09) {
                    currentLineBytes.Add(b);
                }
                i++;
            }

            if (currentLineBytes.Count > 0) {
                flushLine();
            }

            // Trim trailing blank lines
            while (lines.Count > 0 && string.IsNullOrWhiteSpace(lines[lines.Count - 1].Text)) {
                lines.RemoveAt(lines.Count - 1);
            }

            return lines;
        }

        public static bool PrintGdiReceipt(string printerName, byte[] bytes) {
            List<ReceiptLine> lines = ParseEscPosToLines(bytes);

            // Check if there is any non-whitespace text (ignore pure drawer-kick pulses)
            bool hasContent = false;
            foreach (ReceiptLine l in lines) {
                if (!string.IsNullOrWhiteSpace(l.Text)) {
                    hasContent = true;
                    break;
                }
            }
            if (!hasContent) {
                // Pure control command (e.g. cash drawer pulse) -> do not feed a blank sheet on GDI printers
                return true;
            }

            int currentLineIndex = 0;

            using (PrintDocument pd = new PrintDocument()) {
                pd.PrinterSettings.PrinterName = printerName;
                if (!pd.PrinterSettings.IsValid) {
                    Console.Error.WriteLine("ERROR: Invalid GDI printer name: " + printerName);
                    return false;
                }

                pd.DocumentName = "Isaac POS Comprobante";
                pd.OriginAtMargins = false;
                // StandardPrintController suppresses the Windows "Imprimiendo..." popup dialog completely
                pd.PrintController = new StandardPrintController();

                pd.PrintPage += (sender, e) => {
                    Graphics g = e.Graphics;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

                    float leftMargin = 14f;
                    float topMargin = 14f;
                    float pageWidth = e.PageBounds.Width > 0 ? e.PageBounds.Width : 300f;
                    float pageHeight = e.PageBounds.Height > 0 ? e.PageBounds.Height : 1100f;
                    // 275pt (~72mm / 48 monospace chars) so receipt columns align cleanly on both A4/Letter and 80mm rolls
                    float ticketWidth = Math.Min(275f, pageWidth - (leftMargin * 2f));
                    if (ticketWidth < 160f) ticketWidth = pageWidth - 8f;

                    using (Font fontReg = new Font("Consolas", 8.2f, FontStyle.Regular))
                    using (Font fontBold = new Font("Consolas", 8.2f, FontStyle.Bold))
                    using (Font fontLarge = new Font("Consolas", 11.0f, FontStyle.Bold)) {
                        float y = topMargin;

                        while (currentLineIndex < lines.Count) {
                            ReceiptLine line = lines[currentLineIndex];
                            Font activeFont = line.DoubleSize ? fontLarge : (line.Bold ? fontBold : fontReg);
                            float lineHeight = activeFont.GetHeight(g) + 1.5f;

                            if (y + lineHeight > pageHeight - 20f && currentLineIndex < lines.Count - 1) {
                                e.HasMorePages = true;
                                return;
                            }

                            if (!string.IsNullOrEmpty(line.Text)) {
                                using (StringFormat sf = new StringFormat(StringFormat.GenericTypographic)) {
                                    sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
                                    if (line.Align == 1) {
                                        sf.Alignment = StringAlignment.Center;
                                        RectangleF rect = new RectangleF(leftMargin, y, ticketWidth, lineHeight + 4f);
                                        g.DrawString(line.Text, activeFont, Brushes.Black, rect, sf);
                                    } else if (line.Align == 2) {
                                        sf.Alignment = StringAlignment.Far;
                                        RectangleF rect = new RectangleF(leftMargin, y, ticketWidth, lineHeight + 4f);
                                        g.DrawString(line.Text, activeFont, Brushes.Black, rect, sf);
                                    } else {
                                        sf.Alignment = StringAlignment.Near;
                                        g.DrawString(line.Text, activeFont, Brushes.Black, leftMargin, y, sf);
                                    }
                                }
                            }

                            y += lineHeight;
                            currentLineIndex++;
                        }

                        e.HasMorePages = false;
                    }
                };

                pd.Print();
            }

            return true;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct STARTUPINFO {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESS_INFORMATION {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool CreateProcess(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        public static bool QuickCheckPrinterExists(string printerName) {
            if (string.IsNullOrWhiteSpace(printerName)) return false;
            try {
                using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Print\Printers\" + printerName.Trim())) {
                    if (key != null) return true;
                }
            } catch { }

            IntPtr hPrinter = IntPtr.Zero;
            if (OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) {
                ClosePrinter(hPrinter);
                return true;
            }
            return false;
        }

        public static bool SpawnDetachedGdiWorker(string printerName, string workerFilePath) {
            string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            string escapedPrinter = printerName.Replace("\"", "\\\"");
            string escapedFile = workerFilePath.Replace("\"", "\\\"");
            StringBuilder cmdLine = new StringBuilder();
            cmdLine.AppendFormat("\"{0}\" \"{1}\" \"{2}\" --gdi-worker", exePath, escapedPrinter, escapedFile);

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(si);
            si.dwFlags = 0x00000001; // STARTF_USESHOWWINDOW
            si.wShowWindow = 0;      // SW_HIDE

            PROCESS_INFORMATION pi;
            const uint CREATE_NO_WINDOW = 0x08000000;

            bool started = CreateProcess(
                null,
                cmdLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false, // Do NOT inherit stdout/stderr pipes from Node.js execFile
                CREATE_NO_WINDOW,
                IntPtr.Zero,
                null,
                ref si,
                out pi
            );

            if (started) {
                if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
                if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
                return true;
            }
            return false;
        }

        public static int Main(string[] args) {
            if (args.Length == 0) {
                Console.Error.WriteLine("ERROR: Printer name argument required.");
                return 1;
            }

            string printerName = args[0];
            bool forceGdi = false;
            bool isGdiWorker = false;
            string inputFilePath = null;

            for (int i = 1; i < args.Length; i++) {
                if (args[i] == "--gdi" || args[i] == "-g") {
                    forceGdi = true;
                } else if (args[i] == "--gdi-worker") {
                    isGdiWorker = true;
                    forceGdi = true;
                } else if (File.Exists(args[i])) {
                    inputFilePath = args[i];
                }
            }

            byte[] bytes = null;

            try {
                if (inputFilePath != null) {
                    bytes = File.ReadAllBytes(inputFilePath);
                } else {
                    using (MemoryStream ms = new MemoryStream()) {
                        using (Stream stdin = Console.OpenStandardInput()) {
                            byte[] buffer = new byte[4096];
                            int bytesRead;
                            while ((bytesRead = stdin.Read(buffer, 0, buffer.Length)) > 0) {
                                ms.Write(buffer, 0, bytesRead);
                            }
                        }
                        bytes = ms.ToArray();
                    }
                }

                if (bytes == null || bytes.Length == 0) {
                    Console.Error.WriteLine("ERROR: No data received to print.");
                    return 2;
                }

                if (isGdiWorker) {
                    try {
                        bool workerOk = PrintGdiReceipt(printerName, bytes);
                        return workerOk ? 0 : 3;
                    } finally {
                        if (inputFilePath != null && File.Exists(inputFilePath)) {
                            try { File.Delete(inputFilePath); } catch { }
                        }
                    }
                }

                bool useGdi = forceGdi || IsGdiPagePrinter(printerName);
                bool ok = false;

                if (useGdi) {
                    if (!QuickCheckPrinterExists(printerName)) {
                        int err = Marshal.GetLastWin32Error();
                        Console.Error.WriteLine("ERROR: Printer not found in Windows Spooler (" + printerName + "). LastError=" + err);
                        return 3;
                    }

                    // Check if receipt has actual printable text (ignore pure drawer-kick pulses)
                    List<ReceiptLine> lines = ParseEscPosToLines(bytes);
                    bool hasContent = false;
                    foreach (ReceiptLine l in lines) {
                        if (!string.IsNullOrWhiteSpace(l.Text)) {
                            hasContent = true;
                            break;
                        }
                    }

                    if (!hasContent) {
                        Console.WriteLine("SUCCESS_NOOP");
                        return 0;
                    }

                    // Write worker temp file and spawn non-inheriting detached GDI worker
                    // so Node.js execFile resolves in <30ms even if Wi-Fi IPP negotiation takes 5-10 seconds
                    CleanupStaleTempFiles();
                    string workerTemp = Path.Combine(Path.GetTempPath(), "isaac_gdi_" + Guid.NewGuid().ToString("N") + ".bin");
                    File.WriteAllBytes(workerTemp, bytes);
                    if (SpawnDetachedGdiWorker(printerName, workerTemp)) {
                        Console.WriteLine("SUCCESS");
                        return 0;
                    } else {
                        try { File.Delete(workerTemp); } catch { }
                        ok = PrintGdiReceipt(printerName, bytes);
                    }
                } else {
                    ok = SendBytesToPrinter(printerName, bytes);
                    if (!ok) {
                        // Fallback to GDI if RAW datatype is rejected by driver
                        string workerTemp = Path.Combine(Path.GetTempPath(), "isaac_gdi_" + Guid.NewGuid().ToString("N") + ".bin");
                        File.WriteAllBytes(workerTemp, bytes);
                        if (SpawnDetachedGdiWorker(printerName, workerTemp)) {
                            Console.WriteLine("SUCCESS");
                            return 0;
                        } else {
                            try { File.Delete(workerTemp); } catch { }
                            ok = PrintGdiReceipt(printerName, bytes);
                        }
                    }
                }

                if (ok) {
                    Console.WriteLine("SUCCESS");
                    return 0;
                } else {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("ERROR: Win32 Spooler failed to write job. LastError=" + err);
                    return 3;
                }
            } catch (Exception ex) {
                Console.Error.WriteLine("EXCEPTION: " + ex.Message);
                return 4;
            }
        }
    }
}
