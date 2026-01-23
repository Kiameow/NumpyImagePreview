# Change Log

All notable changes to the "Numpy Image Preview" extension will be documented in this file.
## [1.1.0] - 2026-01-23
### Optimized
- use TypedArray to speed up loading image.
- switching tab won't trigger reloading.

### Fixed
- low-contrast image display
- global preference doesn't work 

## [1.0.9] - 2026-01-21
### Added
- add manually selecting start index of channel to support situation that channels may have mask information.

## [1.0.8] - 2026-01-19
### Changed
- add credit in README

## [1.0.7] - 2026-01-19
### Added
- extension now can remember preferred layout option to guarantee consistent experience
- add data layout option for more general usage


## [1.0.6] - 2025-07-29

### Added
- batch data supoort

### Fixed
- color image with float datatype cannot correctly be visualized


## [1.0.5] - 2025-02-13

### Changed
- restrict the canvas height
- when context in canvas get resized, it shows in pixelated way instead of interploted


## [1.0.4] - 2025-02-13

### Changed
- more tight layout

### Added
- support redundant dimension 

## [1.0.3] - 2025-02-11

### Changed
- adjust previewer color according to user theme 


## [1.0.2] - 2024-12-15

### Changed
- modify the package.json to provide more info


## [1.0.1] - 2024-12-15

### Added

- LICENSE

### Changed

- downgrade the vscode package version to make it compatiable with lower version

## [1.0.0] - 2024-12-15

- initial release
