# Generates PWA icons (red marble in a dish) into pwa-assets/. Run: python3 scripts/make-icons.py
from PIL import Image, ImageDraw, ImageFilter
BG=(18,21,28)
def icon(size, maskable=False):
    S=size*4; im=Image.new('RGB',(S,S),BG); d=ImageDraw.Draw(im)
    r=S*(0.34 if maskable else 0.44); c=S/2
    for i in range(40):  # dish: radial gradient
        t=i/39; rr=r*(1-t*0.92)
        col=tuple(int(a+(b-a)*t) for a,b in zip((150,165,190),(200,215,235)))
        d.ellipse([c-rr,c-rr,c+rr,c+rr],fill=col)
    d.ellipse([c-r,c-r,c+r,c+r],outline=(225,232,242),width=int(S*0.02))
    dr=r*0.5; d.ellipse([c-dr,c-dr,c+dr,c+dr],outline=(60,80,110),width=max(2,int(S*0.006)))
    m=r*0.26; sh=Image.new('L',(S,S),0); ImageDraw.Draw(sh).ellipse([c-m+m*0.25,c-m+m*0.35,c+m+m*0.25,c+m+m*0.35],fill=110)
    im.paste((40,50,70),mask=sh.filter(ImageFilter.GaussianBlur(S*0.012)))
    for i in range(30):
        t=i/29; mm=m*(1-t*0.75); ox=-m*0.3*t; oy=-m*0.3*t
        col=tuple(int(a+(b-a)*t) for a,b in zip((150,10,15),(255,90,80)))
        d.ellipse([c+ox-mm,c+oy-mm,c+ox+mm,c+oy+mm],fill=col)
    hl=m*0.18; d.ellipse([c-m*0.45-hl,c-m*0.45-hl,c-m*0.45+hl,c-m*0.45+hl],fill=(255,230,225))
    return im.resize((size,size),Image.LANCZOS)
icon(192).save('pwa-assets/icon-192.png'); icon(512).save('pwa-assets/icon-512.png')
icon(512,True).save('pwa-assets/icon-maskable-512.png'); icon(180).save('pwa-assets/apple-touch-icon.png')
