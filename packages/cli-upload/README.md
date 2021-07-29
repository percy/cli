# @percy/cli-upload

Percy CLI command to uploade a directory of static images to Percy for diffing.

## Commands
<!-- commands -->
* [`percy upload DIRNAME`](#percy-upload-dirname)

## `percy upload DIRNAME`

Upload a directory of images to Percy

```
USAGE
  $ percy upload DIRNAME

ARGUMENTS
  DIRNAME  directory of images to upload

OPTIONS
  -c, --config=config     configuration file path
  -d, --dry-run           prints a list of matching images to upload without uploading
  -e, --strip-extensions  strips file extensions from snapshot names
  -f, --files=files       [default: **/*.{png,jpg,jpeg}] one or more globs matching image file paths to upload
  -i, --ignore=ignore     one or more globs matching image file paths to ignore
  -q, --quiet             log errors only
  -v, --verbose           log everything
  --silent                log nothing

EXAMPLE
  $ percy upload ./images
```
<!-- commandsstop -->

## Percy Configuration

This CLI plugin adds the following Percy configuration options (defaults shown).

```yaml
# defaults
version: 2
upload:
  strip-extensions: false
  files: '**/*.{png,jpg,jpeg}'
  ignore: ''
```

- **strip-extensions** - Strips file extensions from snapshot names
- **files** - A glob or array of globs matching file paths to upload
- **ignore** - A glob or array of globs matching file paths to ignore
