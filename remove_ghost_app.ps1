$path = 'c:\Users\mrive\AndroidStudioProjects\american-pos-backend\public\index.html'
$content = Get-Content $path
$newContent = $content[0..2724] + $content[3636..($content.Count-1)]
$newContent | Set-Content $path -Encoding UTF8
