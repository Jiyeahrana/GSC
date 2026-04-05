const reverseGeocode = async (lat, lng) => {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "PortManagementApp/1.0", // Nominatim requires a User-Agent
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch location data");
  }

  const data = await response.json();

  return {
    city:
      data.address.city ||
      data.address.town ||
      data.address.village ||
      data.address.county ||
      "Unknown",
    country: data.address.country || "Unknown",
  };
};

module.exports = reverseGeocode;