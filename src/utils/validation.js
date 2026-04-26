function parseResearcherNames(body) {
  const rawValue = body.researcher_names;
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map(String).filter(Boolean);
  }

  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      // Fallback to comma-separated parsing.
    }

    return rawValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  parseResearcherNames,
  toNonNegativeInteger,
  toPositiveInteger,
};
