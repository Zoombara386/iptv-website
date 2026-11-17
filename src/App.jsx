import React, { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import "./App.css";

const PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";

function parseM3U(data) {
  const lines = data.split(/\r?\n/);
  const channels = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("#EXTINF")) {
      const name = line.split(",").slice(1).join(",").trim();
      const logo = line.match(/tvg-logo="([^"]*)"/i)?.[1] || "";
      const group = line.match(/group-title="([^"]*)"/i)?.[1] || "";
      const id = line.match(/tvg-id="([^"]*)"/i)?.[1] || "";
      const country =
        line.match(/tvg-country="([^"]*)"/i)?.[1] || "";

      current = {
        id: id || `${name}-${channels.length}`,
        name: name || "Unknown Channel",
        logo,
        group,
        country: country.split(",")[0].trim().toUpperCase(),
        url: "",
      };
    } else if (line && !line.startsWith("#") && current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }

  return channels;
}

function getCategory(channel) {
  const text = `${channel.group} ${channel.name}`.toLowerCase();

  if (/sport|football|soccer|tennis|basketball|cricket|racing|f1|golf/.test(text)) {
    return "Sport";
  }

  if (/movie|cinema|film/.test(text)) {
    return "Movies";
  }

  if (/news|documentary|education|history|science/.test(text)) {
    return "Documentary";
  }

  if (/kids|cartoon|children|animation/.test(text)) {
    return "Kids";
  }

  return "Entertainment";
}

const countryNames = new Intl.DisplayNames(["en"], {
  type: "region",
});

function getCountryName(code) {
  if (!code) return "Unknown country";

  try {
    return countryNames.of(code) || code;
  } catch {
    return code;
  }
}

function ChannelCard({ channel, onPlay }) {
  return (
    <button className="channel-card" onClick={() => onPlay(channel)}>
      <div className="channel-image">
        {channel.logo ? (
          <img
            src={channel.logo}
            alt=""
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span className="logo-placeholder">
            {channel.name.slice(0, 2).toUpperCase()}
          </span>
        )}

        <span className="live-label">LIVE</span>

        <span className="play-overlay">
          <span>▶</span>
        </span>
      </div>

      <div className="channel-info">
        <strong title={channel.name}>{channel.name}</strong>
        <span>
          {channel.group || "Live TV"}
          {channel.country
            ? ` · ${getCountryName(channel.country)}`
            : ""}
        </span>
      </div>
    </button>
  );
}

export default function App() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedCountry, setSelectedCountry] = useState("All");
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [playerError, setPlayerError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const videoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPlaylist() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(PLAYLIST_URL);

        if (!response.ok) {
          throw new Error(`Playlist request failed: ${response.status}`);
        }

        const data = await response.text();
        const parsed = parseM3U(data);

        if (!parsed.length) {
          throw new Error("No channels were found in the playlist.");
        }

        if (!cancelled) {
          setChannels(parsed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            "Could not load the playlist. Check your internet connection and try again."
          );
          console.error("Playlist error:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPlaylist();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected channel in the video player
  useEffect(() => {
    if (!selectedChannel || !videoRef.current) return;

    const video = videoRef.current;
    const streamUrl = selectedChannel.url;
    let hls;

    setPlayerError("");
    video.pause();
    video.removeAttribute("src");
    video.load();

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          setPlayerError("Press play to start this channel.");
        });
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setPlayerError(
            "This stream could not be played. It may be offline or unavailable in your region."
          );
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;

      video.addEventListener(
        "loadedmetadata",
        () => {
          video.play().catch(() => {
            setPlayerError("Press play to start this channel.");
          });
        },
        { once: true }
      );

      video.addEventListener(
        "error",
        () => {
          setPlayerError("This channel could not be played.");
        },
        { once: true }
      );
    } else {
      setPlayerError("Your browser does not support this stream format.");
    }

    return () => {
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [selectedChannel, retryKey]);

  // Automatically find countries in the playlist
  const countries = useMemo(() => {
    const codes = [
      ...new Set(
        channels
          .map((channel) => channel.country)
          .filter(Boolean)
      ),
    ];

    return codes.sort((a, b) =>
      getCountryName(a).localeCompare(getCountryName(b))
    );
  }, [channels]);

  // Apply search, category and country filters together
  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      const matchesSearch = `${channel.name} ${channel.group}`
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesCategory =
        activeCategory === "All" ||
        getCategory(channel) === activeCategory;

      const matchesCountry =
        selectedCountry === "All" ||
        channel.country === selectedCountry;

      return matchesSearch && matchesCategory && matchesCountry;
    });
  }, [channels, search, activeCategory, selectedCountry]);

  const categories = [
    "All",
    "Sport",
    "Movies",
    "Entertainment",
    "Documentary",
    "Kids",
  ];

  const sections = [
    { name: "Sport", description: "Live sports channels" },
    { name: "Movies", description: "Movies and cinema" },
    { name: "Entertainment", description: "Entertainment and TV" },
    { name: "Documentary", description: "Discover something new" },
    { name: "Kids", description: "Family and kids channels" },
  ];

  function playChannel(channel) {
    setSelectedChannel(channel);
    setPlayerError("");
  }

  function closePlayer() {
    setSelectedChannel(null);
    setPlayerError("");
  }

  function resetFilters() {
    setSearch("");
    setActiveCategory("All");
    setSelectedCountry("All");
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#home">
          <span className="brand-icon">S</span>
          <span>STREAM<span>BOX</span></span>
        </a>

        <nav className="main-nav">
          <a href="#home">Home</a>
          <a href="#channels">Channels</a>
        </nav>

        <div className="header-status">
          <span className="status-dot"></span>
          LIVE TV
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-content">
            <span className="hero-tag">YOUR WORLD OF ENTERTAINMENT</span>

            <h1>
              ALL YOUR TV.
              <br />
              <span>ONE PLACE.</span>
            </h1>

            <p>
              Explore live television from around the world.
              Discover sports, movies, entertainment and more.
            </p>

            <a href="#channels" className="hero-button">
              EXPLORE CHANNELS <span>→</span>
            </a>

            <div className="hero-stats">
              <div>
                <strong>{channels.length.toLocaleString()}</strong>
                <span>CHANNELS</span>
              </div>
              <div>
                <strong>{countries.length}</strong>
                <span>COUNTRIES</span>
              </div>
              <div>
                <strong>LIVE</strong>
                <span>STREAMING</span>
              </div>
            </div>
          </div>

          <div className="hero-decoration">
            <div className="hero-circle circle-one"></div>
            <div className="hero-circle circle-two"></div>
            <div className="hero-play">▶</div>
            <div className="hero-glow"></div>
          </div>
        </section>

        <section className="content-section" id="channels">
          <div className="section-heading">
            <div>
              <span className="section-kicker">DISCOVER</span>
              <h2>Explore Channels</h2>
              <p>Find channels by country, category or name.</p>
            </div>

            <div className="channel-count">
              {filteredChannels.length.toLocaleString()} CHANNELS
            </div>
          </div>

          <div className="filter-toolbar">
            <div className="search-box">
              <span>⌕</span>
              <input
                type="text"
                placeholder="Search channels..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              {search && (
                <button onClick={() => setSearch("")}>✕</button>
              )}
            </div>

            <div className="country-filter">
              <label htmlFor="country-select">COUNTRY</label>

              <select
                id="country-select"
                value={selectedCountry}
                onChange={(event) =>
                  setSelectedCountry(event.target.value)
                }
              >
                <option value="All">All countries</option>

                {countries.map((code) => (
                  <option key={code} value={code}>
                    {getCountryName(code)}
                  </option>
                ))}

                <option value="Unknown">Unknown country</option>
              </select>
            </div>

            {(search ||
              activeCategory !== "All" ||
              selectedCountry !== "All") && (
              <button className="reset-filters" onClick={resetFilters}>
                RESET FILTERS ✕
              </button>
            )}
          </div>

          <div className="category-list">
            {categories.map((category) => (
              <button
                key={category}
                className={
                  activeCategory === category ? "category active" : "category"
                }
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          {loading && (
            <div className="message-panel">
              <div className="loader"></div>
              <h3>Loading your channels</h3>
              <p>Connecting to the StreamBox playlist...</p>
            </div>
          )}

          {!loading && error && (
            <div className="message-panel">
              <h3>Unable to load channels</h3>
              <p>{error}</p>
              <button
                className="hero-button"
                onClick={() => window.location.reload()}
              >
                TRY AGAIN
              </button>
            </div>
          )}

          {!loading && !error && (
            <div className="channel-section">
              <div className="row-heading">
                <div>
                  <h2>
                    {selectedCountry === "All"
                      ? "All Channels"
                      : getCountryName(selectedCountry)}
                  </h2>
                  <p>
                    {filteredChannels.length.toLocaleString()} matching channels
                  </p>
                </div>
              </div>

              {filteredChannels.length ? (
                <div className="channel-grid">
                  {filteredChannels.map((channel, index) => (
                    <ChannelCard
                      key={`${channel.id}-${index}`}
                      channel={channel}
                      onPlay={playChannel}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h3>No channels found</h3>
                  <p>
                    Try another country, category or search term.
                  </p>
                  <button
                    className="hero-button"
                    onClick={resetFilters}
                  >
                    RESET FILTERS
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <a className="brand" href="#home">
          <span className="brand-icon">S</span>
          <span>STREAM<span>BOX</span></span>
        </a>

        <p>Explore live television from around the world.</p>
        <span>StreamBox · Use streams you are authorized to access.</span>
      </footer>

      {selectedChannel && (
        <div className="player-backdrop" onClick={closePlayer}>
          <div
            className="player-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="player-header">
              <div>
                <span className="player-live-dot"></span>
                NOW PLAYING
                <h2>{selectedChannel.name}</h2>
              </div>

              <button
                className="close-player"
                onClick={closePlayer}
                aria-label="Close player"
              >
                ✕
              </button>
            </div>

            <div className="video-container">
              <video
                ref={videoRef}
                controls
                autoPlay
                playsInline
                className="video-player"
              />

              {playerError && (
                <div className="player-error">
                  <div className="error-icon">!</div>
                  <h3>Stream unavailable</h3>
                  <p>{playerError}</p>

                  <button
                    className="hero-button"
                    onClick={() => setRetryKey((value) => value + 1)}
                  >
                    RETRY STREAM
                  </button>
                </div>
              )}
            </div>

            <div className="player-footer">
              <span>
                {selectedChannel.country
                  ? getCountryName(selectedChannel.country)
                  : "Unknown country"}
              </span>
              <span>STREAMBOX PLAYER</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}