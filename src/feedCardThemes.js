// Curated FeedCard gradient themes.
// Each theme is tuned to the same tonal profile as the original design:
// a very light top (0%) for legible dark text and header content,
// stepping down through a mid tone (35%, 70%) to a deeper saturated
// edge (100%). Keeping every theme in this same light-to-mid range is
// what makes them "universal" — dark text, the score-driven fog cover,
// and the photo fade transition all keep working correctly no matter
// which one a user picks.
//
// `fadeColor` matches each gradient's 35% stop and is used for the
// soft fade strip where the header meets a user's photo, so the
// transition never clashes regardless of the theme chosen.

export const feedCardThemes = [
  {
    id: "ocean",
    name: "Ocean",
    gradient: "radial-gradient(circle 340px at 50% 0%, #eaf3ff 0%, #bcdcff 35%, #7fb8ef 70%, #5a9edd 100%)",
    fadeColor: "#bcdcff",
  },
  {
    id: "lavender",
    name: "Lavender",
    gradient: "radial-gradient(circle 340px at 50% 0%, #f3eefe 0%, #dcc9fa 35%, #b895ee 70%, #8f5fdb 100%)",
    fadeColor: "#dcc9fa",
  },
  {
    id: "meadow",
    name: "Meadow",
    gradient: "radial-gradient(circle 340px at 50% 0%, #eef9ec 0%, #c8ecc0 35%, #93d481 70%, #5fae4c 100%)",
    fadeColor: "#c8ecc0",
  },
  {
    id: "sunset",
    name: "Sunset",
    gradient: "radial-gradient(circle 340px at 50% 0%, #fff1ec 0%, #ffd0bb 35%, #ffa27a 70%, #f4744a 100%)",
    fadeColor: "#ffd0bb",
  },
  {
    id: "blush",
    name: "Blush",
    gradient: "radial-gradient(circle 340px at 50% 0%, #fdeef3 0%, #f8c9da 35%, #f093b7 70%, #e15f92 100%)",
    fadeColor: "#f8c9da",
  },
  {
    id: "amber",
    name: "Amber",
    gradient: "radial-gradient(circle 340px at 50% 0%, #fff8e6 0%, #ffe3a3 35%, #ffc85e 70%, #e6a532 100%)",
    fadeColor: "#ffe3a3",
  },
  {
    id: "teal",
    name: "Teal",
    gradient: "radial-gradient(circle 340px at 50% 0%, #eaf7f6 0%, #bfe8e4 35%, #7dcac2 70%, #3ea89d 100%)",
    fadeColor: "#bfe8e4",
  },
  {
    id: "grape",
    name: "Grape",
    gradient: "radial-gradient(circle 340px at 50% 0%, #f5eefe 0%, #ddc4f7 35%, #b98aec 70%, #8a4fd1 100%)",
    fadeColor: "#ddc4f7",
  },
];

export default feedCardThemes;