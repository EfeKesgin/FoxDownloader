# FoxDownloader logosunu üretir: 512x512 ana görsel + 128/48/32/16 PNG ikonlar.
# Saf .NET (System.Drawing) kullanır; dış bağımlılık yoktur.
Add-Type -AssemblyName System.Drawing

function New-FoxBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $size / 512.0
    $g.ScaleTransform($s, $s)

    # ---- arka plan: yuvarlatılmış kare + turuncu degrade ----
    $r = 108
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $path.AddArc(512 - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $path.AddArc(512 - $r * 2, 512 - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc(0, 512 - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $c1 = [System.Drawing.Color]::FromArgb(255, 255, 158, 61)
    $c2 = [System.Drawing.Color]::FromArgb(255, 240, 96, 32)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point(512, 512)), $c1, $c2)
    $g.FillPath($grad, $path)

    # ---- kulaklar (krem) ----
    $cream = [System.Drawing.Color]::FromArgb(255, 250, 246, 238)
    $dark = [System.Drawing.Color]::FromArgb(255, 43, 36, 32)
    $inner = [System.Drawing.Color]::FromArgb(255, 255, 186, 130)
    $earL = New-Object System.Drawing.Drawing2D.GraphicsPath
    $earL.AddPolygon(@(
        (New-Object System.Drawing.Point(104, 214)),
        (New-Object System.Drawing.Point(126, 78)),
        (New-Object System.Drawing.Point(238, 168))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($cream)), $earL)
    $earR = New-Object System.Drawing.Drawing2D.GraphicsPath
    $earR.AddPolygon(@(
        (New-Object System.Drawing.Point(408, 214)),
        (New-Object System.Drawing.Point(386, 78)),
        (New-Object System.Drawing.Point(274, 168))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($cream)), $earR)
    # iç kulak
    $inL = New-Object System.Drawing.Drawing2D.GraphicsPath
    $inL.AddPolygon(@(
        (New-Object System.Drawing.Point(140, 196)),
        (New-Object System.Drawing.Point(148, 126)),
        (New-Object System.Drawing.Point(212, 176))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($inner)), $inL)
    $inR = New-Object System.Drawing.Drawing2D.GraphicsPath
    $inR.AddPolygon(@(
        (New-Object System.Drawing.Point(372, 196)),
        (New-Object System.Drawing.Point(364, 126)),
        (New-Object System.Drawing.Point(300, 176))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($inner)), $inR)

    # ---- yüz: geniş üst, sivri çene (bezier) ----
    $face = New-Object System.Drawing.Drawing2D.GraphicsPath
    $face.AddBezier(
        (New-Object System.Drawing.Point(104, 200)),
        (New-Object System.Drawing.Point(150, 168)),
        (New-Object System.Drawing.Point(352, 168)),
        (New-Object System.Drawing.Point(408, 200))
    )
    $face.AddBezier(
        (New-Object System.Drawing.Point(408, 200)),
        (New-Object System.Drawing.Point(396, 306)),
        (New-Object System.Drawing.Point(320, 402)),
        (New-Object System.Drawing.Point(256, 434))
    )
    $face.AddBezier(
        (New-Object System.Drawing.Point(256, 434)),
        (New-Object System.Drawing.Point(192, 402)),
        (New-Object System.Drawing.Point(116, 306)),
        (New-Object System.Drawing.Point(104, 200))
    )
    $face.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush($cream)), $face)

    # ---- burun bölgesi (daha açık) ----
    $muz = New-Object System.Drawing.Drawing2D.GraphicsPath
    $muz.AddEllipse(196, 300, 120, 104)
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))), $muz)

    # ---- gözler ----
    $eye = New-Object System.Drawing.SolidBrush($dark)
    $g.FillEllipse($eye, 176, 244, 30, 38)
    $g.FillEllipse($eye, 306, 244, 30, 38)
    # göz parlaması
    $gl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
    $g.FillEllipse($gl, 182, 250, 11, 13)
    $g.FillEllipse($gl, 312, 250, 11, 13)

    # ---- burun ----
    $nose = New-Object System.Drawing.Drawing2D.GraphicsPath
    $nose.AddPolygon(@(
        (New-Object System.Drawing.Point(256, 338)),
        (New-Object System.Drawing.Point(292, 316)),
        (New-Object System.Drawing.Point(286, 356)),
        (New-Object System.Drawing.Point(256, 374)),
        (New-Object System.Drawing.Point(226, 356)),
        (New-Object System.Drawing.Point(220, 316))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($dark)), $nose)

    $g.Dispose()
    return $bmp
}

$outDir = 'C:\Users\user\Desktop\videodownloader\icons'
$master = New-FoxBitmap 512
$master.Save((Join-Path $outDir 'fox-master.png'), [System.Drawing.Imaging.ImageFormat]::Png)
foreach ($sz in 128, 48, 32, 16) {
    $b = New-FoxBitmap $sz
    $b.Save((Join-Path $outDir ('icon' + $sz + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    $b.Dispose()
}
$master.Dispose()
'o zapisano: fox-master.png + icon128/48/32/16.png'
