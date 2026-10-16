import os
import sys
import zipfile

def package_rom():
    source_dir = "Racing Lagoon (Japan) [SLPS-02038] (1)"
    bin_file = os.path.join(source_dir, "Track 01.bin")
    out_zip = os.path.join("roms", "racing_lagoon.zip")

    if not os.path.exists(bin_file):
        print(f"Error: {bin_file} not found!")
        sys.exit(1)

    print(f"Empaquetando {bin_file} en {out_zip}...")
    
    cue_content = (
        'FILE "racing_lagoon.bin" BINARY\n'
        '  TRACK 01 MODE2/2352\n'
        '    INDEX 01 00:00:00\n'
    ).encode('utf-8')

    with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_STORED) as zf:
        # Write CUE sheet
        zf.writestr('racing_lagoon.cue', cue_content)
        print(" -> racing_lagoon.cue agregado.")
        
        # Write BIN file with arcname racing_lagoon.bin
        print(" -> Copiando datos binarios (714 MB, puede tomar unos segundos)...")
        zf.write(bin_file, arcname='racing_lagoon.bin')

    print(f"✅ ¡Éxito! Archivo creado: {out_zip} ({os.path.getsize(out_zip)} bytes)")

if __name__ == '__main__':
    package_rom()
