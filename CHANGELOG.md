# Change Log

All notable changes to the "Log to Runnable SQL (SQLAlchemy)" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0] - 2024-12-24

### Added

- Initial release
- Instant parameter injection: Automatically replaces `%(key)s` placeholders with dictionary values
- Support for 3 SQLAlchemy log formats (Engine logs, Statement/Parameters, Bracketed SQL)
- SQL formatting with `sql-formatter`
- Syntax highlighting with VS 2015 Dark theme
- One-click copy to clipboard
- Status bar integration with "SQL Fill" button
