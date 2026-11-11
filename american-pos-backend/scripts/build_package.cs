using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;

class Packager {
    private static readonly HashSet<string> ExcludedDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        ".wwebjs_auth",
        ".wwebjs_cache",
        "backups",
        "logs",
        "dist_installer",
        "dist_final_installer",
        ".git",
        "bin",
        "obj"
    };

    private static readonly HashSet<string> ExcludedFilePrefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "test_",
        "check_",
        "debug_",
        "fix_",
        "inspect_",
        "find_",
        "temp_"
    };

    private static readonly HashSet<string> ExcludedExactFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "backup_debug.log",
        "real_token.json",
        "app_payload.zip"
    };

    private static void ScanDirectory(string rootDir, string currentDir, List<string> allFiles) {
        foreach (string dir in Directory.GetDirectories(currentDir)) {
            string dirName = Path.GetFileName(dir);
            if (ExcludedDirs.Contains(dirName)) continue;
            ScanDirectory(rootDir, dir, allFiles);
        }

        foreach (string file in Directory.GetFiles(currentDir)) {
            string fileName = Path.GetFileName(file);
            if (ExcludedExactFiles.Contains(fileName)) continue;

            if (currentDir.Equals(rootDir, StringComparison.OrdinalIgnoreCase)) {
                bool skip = false;
                foreach (string prefix in ExcludedFilePrefixes) {
                    if (fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
                        skip = true;
                        break;
                    }
                }
                if (skip) continue;
                if (fileName.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) ||
                    fileName.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) {
                    continue;
                }
            }

            allFiles.Add(file);
        }
    }

    public static int Main(string[] args) {
        string rootDir = Directory.GetCurrentDirectory();
        string outDir = Path.Combine(rootDir, "dist_installer");
        if (!Directory.Exists(outDir)) Directory.CreateDirectory(outDir);

        string zipPath = Path.Combine(outDir, "app_payload.zip");
        if (File.Exists(zipPath)) File.Delete(zipPath);

        Console.WriteLine("[Packager] Iniciando empaquetado limpio de Isaac POS Ultra...");
        Console.WriteLine("[Packager] Directorio base: " + rootDir);
        Console.WriteLine("[Packager] Archivo destino: " + zipPath);

        List<string> allFiles = new List<string>();
        ScanDirectory(rootDir, rootDir, allFiles);
        Console.WriteLine("[Packager] Total de archivos seleccionados: " + allFiles.Count);

        using (FileStream zipToOpen = new FileStream(zipPath, FileMode.Create)) {
            using (ZipArchive archive = new ZipArchive(zipToOpen, ZipArchiveMode.Create)) {
                int count = 0;
                long totalBytes = 0;
                foreach (string file in allFiles) {
                    string relPath = file.Substring(rootDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    archive.CreateEntryFromFile(file, relPath, CompressionLevel.Fastest);
                    count++;
                    totalBytes += new FileInfo(file).Length;
                    if (count % 2000 == 0 || count == allFiles.Count) {
                        Console.WriteLine(string.Format("[Packager] Empaquetados {0}/{1} archivos ({2:F1} MB)...", count, allFiles.Count, totalBytes / 1048576.0));
                    }
                }
            }
        }

        FileInfo fi = new FileInfo(zipPath);
        Console.WriteLine(string.Format("[Packager] ¡Empaquetado completado! Tamano final: {0:F2} MB", fi.Length / 1048576.0));
        return 0;
    }
}
