import fs from 'fs';
import * as ResEdit from 'resedit';

function windowsPostBuild(output) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(output));
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync('./scripts/files/percy.ico'));

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033,
    iconFile.icons.map(item => item.data)
  );

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];

  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'PercyCLI',
      FileDescription: 'Percy CLI Binary',
      CompanyName: 'BrowserStack Inc.',
      LegalCopyright: 'Copyright BrowserStack Limited',
      OriginalFilename: 'PercyCLI',
      InternalName: 'PercyCLI'
    }
  );
  vi.setFileVersion(1, 28, 8);
  vi.setProductVersion(1, 28, 8);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(output, Buffer.from(exe.generate()));
}

windowsPostBuild('percy.exe');
