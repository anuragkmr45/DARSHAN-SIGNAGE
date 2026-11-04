# Default product marks: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`.

- The default CMS mark and player app icon use one original eye motif with flat Forest, off-white and pale-green fills. Customer branding URLs continue to override the CMS default mark and favicon.
- The player SVG was rasterized to the existing packaging paths: `resources/icon.png` and `resources/icons/{16,32,64,128,256,512}x*.png`. The 512px and 16px PNGs were inspected. File headers report the expected dimensions for all six sizes.
- The CMS fallback `favicon.ico` contains a 64px PNG generated from the default SVG. Its ICO header and PNG signature were checked, and the embedded mark was visually inspected.
- The CMS production build and bundle budget passed. Its built SVG exactly matches source and its built ICO has the expected header.

This checks source and build assets. A packaged Ubuntu/Windows installer and running app, desktop launcher, task switcher, high-DPI scaling and customer-brand override remain to verify.
