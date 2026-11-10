# Architecture rules
- Invoice and receipt views share one document model and renderer; PDF exports use the same loaded records to avoid mismatched financial output.
- Password reset classifications and CSV escaping live in a tested helper shared by dashboard filtering and exports.