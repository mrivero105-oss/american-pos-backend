using System;
using System.IO;
using System.IO.Compression;

class CleanPackager {
    public static int Main(string[] args) {
        string rootDir = Directory.GetCurrentDirectory();
        string distDir = Path.Combine(rootDir, "dist_installer");
        string listFile = Path.Combine(distDir, "filelist.txt");
        string zipPath = Path.Combine(distDir, "app_payload.zip");

        if (!File.Exists(listFile)) {
            Console.WriteLine("[Error] No se encontró filelist.txt");
            return 1;
        }

        if (File.Exists(zipPath)) File.Delete(zipPath);

        Console.WriteLine("[CleanPackager] Empaquetando distribución limpia de 56 MB...");
        string[] lines = File.ReadAllLines(listFile);
        Console.WriteLine(string.Format("[CleanPackager] Total de archivos en lista: {0}", lines.Length));

        using (FileStream zipToOpen = new FileStream(zipPath, FileMode.Create)) {
            using (ZipArchive archive = new ZipArchive(zipToOpen, ZipArchiveMode.Create)) {
                int count = 0;
                long totalRawBytes = 0;
                foreach (string line in lines) {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    string[] parts = line.Split('\t');
                    if (parts.Length < 2) continue;

                    string full = parts[0];
                    string rel = parts[1];

                    if (File.Exists(full)) {
                        archive.CreateEntryFromFile(full, rel, CompressionLevel.Optimal);
                        count++;
                        totalRawBytes += new FileInfo(full).Length;
                        if (count % 2000 == 0 || count == lines.Length) {
                            Console.WriteLine(string.Format("[CleanPackager] Procesados {0}/{1} archivos ({2:F1} MB sin comprimir)...", count, lines.Length, totalRawBytes / 1048576.0));
                        }
                    }
                }
            }
        }

        FileInfo fi = new FileInfo(zipPath);
        Console.WriteLine(string.Format("[CleanPackager] ¡EMPAQUETADO LIMPIO CONCLUIDO CON ÉXITO!"));
        Console.WriteLine(string.Format("[CleanPackager] Tamaño comprimido final: {0:F2} MB", fi.Length / 1048576.0));
        return 0;
    }
}
