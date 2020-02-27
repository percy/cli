import expect from 'expect';
import { getWrite, stdio } from './helpers';
import { Create } from '../src/commands/config/create';
import PercyConfig from '../src';

describe('percy config:create', () => {
  it('creates a .percy.yml config file by default', async () => {
    await stdio.capture(() => Create.run([]));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: .percy.yml\n']);
    expect(getWrite('.percy.yml')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percyrc config file', async () => {
    await stdio.capture(() => Create.run(['--rc']));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: .percyrc\n']);
    expect(getWrite('.percyrc')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.yaml config file', async () => {
    await stdio.capture(() => Create.run(['--yaml']));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: .percy.yaml\n']);
    expect(getWrite('.percy.yaml')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.yml config file', async () => {
    await stdio.capture(() => Create.run(['--yml']));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: .percy.yml\n']);
    expect(getWrite('.percy.yml')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.json config file', async () => {
    await stdio.capture(() => Create.run(['--json']));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: .percy.json\n']);
    expect(getWrite('.percy.json')).toBe(PercyConfig.stringify('json'));
  });

  it('can create a .percy.js config file', async () => {
    await stdio.capture(() => Create.run(['--js']));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: .percy.js\n']);
    expect(getWrite('.percy.js')).toBe(PercyConfig.stringify('js'));
  });

  it('can create specific config files', async () => {
    await stdio.capture(() => Create.run(['config/percy.config.js']));
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Created Percy config: config/percy.config.js\n']);
    expect(getWrite('config/percy.config.js')).toBe(PercyConfig.stringify('js'));
  });

  it('logs an error and exits when the filetype is unsupported', async () => {
    await expect(stdio.capture(() => (
      Create.run(['config/percy.config.php'])
    ))).rejects.toThrow('EEXIT: 1');
    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(['[percy] Unsupported filetype: php\n']);
  });

  it('logs an error and exits when the config file already exists', async () => {
    await stdio.capture(() => Create.run(['.percy.yml']));
    await expect(stdio.capture(() => (
      Create.run(['.percy.yml'])
    ))).rejects.toThrow('EEXIT: 1');
    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(['[percy] Percy config already exists: .percy.yml\n']);
  });
});
