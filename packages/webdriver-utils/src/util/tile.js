export default class Tile {
  constructor({
    filepath,
    statusBarHeight,
    navBarHeight,
    headerHeight,
    footerHeight,
    fullscreen,
    sha
  }) {
    this.filepath = filepath;
    this.statusBarHeight = statusBarHeight;
    this.navBarHeight = navBarHeight;
    this.headerHeight = headerHeight;
    this.footerHeight = footerHeight;
    this.fullscreen = fullscreen;
    this.sha = sha;
  }
}
