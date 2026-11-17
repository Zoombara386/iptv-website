const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3001;

app.use(cors());

app.get("/api/playlist", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({
      error: "Missing playlist URL",
    });
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({
        error: `Playlist returned HTTP ${response.status}`,
      });
    }

    const text = await response.text();

    res.type("text/plain").send(text);
  } catch (error) {
    console.error("Playlist error:", error);

    res.status(500).json({
      error: "Could not download playlist",
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `StreamBox server running on http://localhost:${PORT}`
  );
});