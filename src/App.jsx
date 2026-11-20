import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import "./App.css";

const PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";
const PAGE_SIZE = 48;
const CATEGORIES = ["All", "Movies", "Series", "Sport", "Entertainment", "Documentary", "Kids", "News"];

function parseLine(line, state, channels) {
  const value = line.trim();
  if (value.startsWith("#EXTINF")) {
    const comma = value.lastIndexOf(",");
    const name = comma >= 0 ? value.slice(comma + 1).trim() : "Unknown channel";
    state.current = {
      id: value.match(/tvg-id="([^"]*)"/i)?.[1] || `${name}-${channels.length}`,
      name: name || "Unknown channel",
      logo: value.match(/tvg-logo="([^"]*)"/i)?.[1] || "",
      group: value.match(/group-title="([^"]*)"/i)?.[1] || "",
      url: "",
    };
  } else if (value && !value.startsWith("#") && state.current) {
    state.current.url = value;
    channels.push(state.current);
    state.current = null;
  }
}

async function loadM3U(url, onProgress, signal) {
  const response = await fetch(url, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`Playlist request failed (${response.status})`);

  const channels = [];
  const state = { current: null };
  let buffer = "";
  let lastPublished = 0;

  if (!response.body?.getReader) {
    const text = await response.text();
    for (const line of text.split(/\r?\n/)) parseLine(line, state, channels);
    onProgress(channels.slice(), true);
    return channels;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      parseLine(line, state, channels);
      if (channels.length - lastPublished >= 150) {
        lastPublished = channels.length;
        onProgress(channels.slice(), false);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) parseLine(buffer, state, channels);
  onProgress(channels.slice(), true);
  return channels;
}

function getCategory(channel) {
  const text = `${channel.group || ""} ${channel.name || ""}`.toLowerCase();
  if (/fox\s? sports|foxsports|sport|football|soccer|tennis|basketball|cricket|racing|formula\s?1|\bf1\b|golf|rugby/.test(text)) return "Sport";
  if (/kids|cartoon|children|animation|nick(elodeon)?|disney junior/.test(text)) return "Kids";
  if (/documentary|history|science|nature|discovery|national geographic|\bnat geo\b/.test(text)) return "Documentary";
  if (/\bnews\b|news channel|cnn|bbc news|al jazeera/.test(text)) return "News";
  if (/series|drama|tv show/.test(text)) return "Series";
  if (/movie|movies|cinema|film|action|premiere|canal\s?\+?\s?(cinema|cine|action|film)/.test(text)) return "Movies";
  return "Entertainment";
}

function ChannelCard({ channel, onPlay, index = 0 }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <button
      className="channel-card focusable"
      onClick={() => onPlay(channel)}
      type="button"
      aria-label={`Play ${channel.name}`}
      style={{ "--card-index": Math.min(index, 12) }}
    >
      <div className="channel-image">
        {channel.logo && !logoFailed ? (
          <img
            src={channel.logo}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span className="logo-placeholder">{channel.name.slice(0, 2).toUpperCase()}</span>
        )}
        <span className="live-label">LIVE</span>
        <span className="play-overlay"><span>▶</span></span>
      </div>
      <div className="channel-info">
        <strong title={channel.name}>{channel.name}</strong>
        <span>{channel.group || getCategory(channel)}</span>
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [playerError, setPlayerError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [recentChannels, setRecentChannels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("streambox-recent") || "[]"); }
    catch { return []; }
  });
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const videoRef = useRef(null);
  const abortRef = useRef(null);

  const fetchPlaylist = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    setChannels([]);
    try {
      const result = await loadM3U(PLAYLIST_URL, (partial) => {
        if (!controller.signal.aborted) {
          setChannels(partial);
          if (partial.length) setLoading(false);
        }
      }, controller.signal);
      if (!controller.signal.aborted) {
        setChannels(result);
        if (!result.length) throw new Error("The playlist did not contain any playable channel entries.");
      }
    } catch (err) {
      if (err.name !== "AbortError" && !controller.signal.aborted) {
        console.error("StreamBox playlist error:", err);
        setError("StreamBox could not load the playlist. Check your connection and try again.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylist();
    return () => abortRef.current?.abort();
  }, [fetchPlaylist]);

  useEffect(() => {
    if (!selectedChannel || !videoRef.current) return undefined;
    const video = videoRef.current;
    const url = selectedChannel.url;
    let hls = null;
    let cancelled = false;
    let recoveredMediaError = false;

    setPlayerError("");
    video.pause();
    video.removeAttribute("src");
    video.load();

    const showFailure = () => {
      if (!cancelled) setPlayerError("This stream did not start. It may be offline, restricted by its provider, or require a supported stream format.");
    };

    const startHls = () => {
      if (!Hls.isSupported()) {
        showFailure();
        return;
      }
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        maxBufferLength: 20,
        backBufferLength: 30,
        manifestLoadingTimeOut: 20000,
        levelLoadingTimeOut: 20000,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) video.play().catch(() => setPlayerError("Press Play on the video controls to start this channel."));
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || cancelled) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
          recoveredMediaError = true;
          hls.recoverMediaError();
        } else {
          showFailure();
        }
      });
    };

    const isHls = /\.m3u8?(?:[?#]|$)|m3u8/i.test(url);
    if (isHls && Hls.isSupported()) {
      startHls();
    } else {
      video.src = url;
      video.play().catch(() => {
        if (!cancelled && Hls.isSupported() && !isHls) startHls();
        else if (!cancelled) setPlayerError("Press Play on the video controls. If it still fails, this stream may be unavailable.");
      });
      video.onerror = () => {
        if (!cancelled && Hls.isSupported() && !isHls) startHls();
        else showFailure();
      };
    }

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [selectedChannel, retryKey]);

  const filteredChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return channels.filter((channel) => {
      const matchesText = !query || `${channel.name} ${channel.group}`.toLowerCase().includes(query);
      const matchesCategory = activeCategory === "All" || getCategory(channel) === activeCategory;
      return matchesText && matchesCategory;
    });
  }, [channels, search, activeCategory]);

  const featuredChannels = useMemo(() => {
    const priority = channels.filter((channel) => /fox\s? sports|foxsports|canal\s?\+|sport|movie/i.test(`${channel.name} ${channel.group}`));
    const source = priority.length >= 5 ? priority : channels;
    return source.slice(0, 8);
  }, [channels]);
  const currentFeatured = featuredChannels[featuredIndex % Math.max(featuredChannels.length, 1)];

  const categoryGroups = useMemo(() => {
    const groups = {};
    for (const category of CATEGORIES.slice(1)) groups[category] = [];
    for (const channel of channels) groups[getCategory(channel)].push(channel);
    return groups;
  }, [channels]);

  function playChannel(channel) {
    // When a title is opened from All, return to its own section after playback.
    if (activeCategory === "All") setActiveCategory(getCategory(channel));
    setVisibleCount(PAGE_SIZE);
    setSelectedChannel(channel);
    setPlayerError("");
    setRecentChannels((previous) => {
      const next = [channel, ...previous.filter((item) => item.id !== channel.id)].slice(0, 10);
      try { localStorage.setItem("streambox-recent", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
      return next;
    });
  }

  function closePlayer() {
    setSelectedChannel(null);
    setPlayerError("");
    requestAnimationFrame(() => {
      document.getElementById("browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function resetFilters() {
    setSearch("");
    setActiveCategory("All");
    setVisibleCount(PAGE_SIZE);
  }

  // Android TV / keyboard remote navigation.
  useEffect(() => {
    function handleRemote(event) {
      const key = event.key;
      if (["Escape", "Backspace", "BrowserBack", "GoBack"].includes(key)) {
        if (selectedChannel) {
          event.preventDefault();
          closePlayer();
        } else if (activeCategory !== "All" || search) {
          event.preventDefault();
          resetFilters();
        }
        return;
      }

      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;
      const active = document.activeElement;
      if (active?.tagName === "INPUT" || active?.tagName === "VIDEO") return;
      const selector = ".focusable, .category, .hero-button, .view-all, .featured-controls button, .search-box button, .back-home-player, .close-player";
      const items = [...document.querySelectorAll(selector)].filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width && rect.height && getComputedStyle(el).visibility !== "hidden";
      });
      if (!items.length) return;
      const current = items.includes(active) ? active : null;
      if (!current) {
        items[0].focus();
        event.preventDefault();
        return;
      }
      const a = current.getBoundingClientRect();
      const ax = a.left + a.width / 2;
      const ay = a.top + a.height / 2;
      let best = null;
      let bestScore = Infinity;
      for (const candidate of items) {
        if (candidate === current) continue;
        const r = candidate.getBoundingClientRect();
        const dx = r.left + r.width / 2 - ax;
        const dy = r.top + r.height / 2 - ay;
        const primary = key === "ArrowLeft" ? -dx : key === "ArrowRight" ? dx : key === "ArrowUp" ? -dy : dy;
        if (primary <= 0) continue;
        const cross = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
        const score = primary + cross * 2.2;
        if (score < bestScore) { bestScore = score; best = candidate; }
      }
      if (best) {
        event.preventDefault();
        best.focus();
      }
    }
    window.addEventListener("keydown", handleRemote);
    return () => window.removeEventListener("keydown", handleRemote);
  }, [selectedChannel, activeCategory, search]);

  const renderGrid = (items, limit = PAGE_SIZE) => (
    <>
      <div className="channel-grid">
        {items.slice(0, limit).map((channel, index) => (
          <ChannelCard key={`${channel.id}-${index}`} channel={channel} onPlay={playChannel} index={index} />
        ))}
      </div>
      {items.length > limit && (
        <button className="load-more focusable" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
          LOAD MORE CHANNELS <span>↓</span>
        </button>
      )}
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand focusable" href="#home" aria-label="StreamBox home">
          <span className="brand-icon">S</span><span>STREAM<span>BOX</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="focusable" href="#home">Home</a>
          <a className="focusable" href="#browse">Browse</a>
          <a className="focusable" href="#sports">Sports</a>
        </nav>
        <div className="header-status"><span className="status-dot" /> LIVE TV</div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-content">
            <span className="hero-tag">YOUR ENTERTAINMENT HUB</span>
            <h1>YOUR SCREEN.<br /><span>YOUR STREAM.</span></h1>
            <p>Movies, sports and live television in one simple place. Pick a channel and start watching.</p>
            <a href="#browse" className="hero-button focusable">EXPLORE STREAMBOX <span>→</span></a>
            <div className="hero-stats">
              <div><strong>{channels.length.toLocaleString()}</strong><span>CHANNELS</span></div>
              <div><strong>LIVE</strong><span>STREAMING</span></div>
              <div><strong>ALL</strong><span>ON ONE SCREEN</span></div>
            </div>
          </div>
          <div className="hero-decoration" aria-hidden="true">
            <div className="hero-circle circle-one" /><div className="hero-circle circle-two" />
            <div className="hero-play">▶</div><div className="hero-glow" />
          </div>
        </section>

        {currentFeatured && !loading && (
          <section className="featured-section">
            <div className="featured-copy">
              <span className="section-kicker">HAND-PICKED FOR YOU</span>
              <h2>Featured on StreamBox</h2>
              <h3>{currentFeatured.name}</h3>
              <p>{currentFeatured.group || getCategory(currentFeatured)} · Available in your playlist</p>
              <button className="hero-button focusable" type="button" onClick={() => playChannel(currentFeatured)}>▶ WATCH NOW</button>
              <div className="featured-controls">
                <button className="focusable" type="button" aria-label="Previous featured channel" onClick={() => setFeaturedIndex((i) => (i - 1 + featuredChannels.length) % featuredChannels.length)}>←</button>
                <span>{(featuredIndex % featuredChannels.length) + 1} / {featuredChannels.length}</span>
                <button className="focusable" type="button" aria-label="Next featured channel" onClick={() => setFeaturedIndex((i) => (i + 1) % featuredChannels.length)}>→</button>
              </div>
            </div>
            <div className="featured-art">
              {currentFeatured.logo ? <img src={currentFeatured.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span>{currentFeatured.name.slice(0, 2).toUpperCase()}</span>}
              <span className="featured-live">● IN PLAYLIST</span>
            </div>
          </section>
        )}

        {recentChannels.length > 0 && (
          <section className="content-section continue-section">
            <div className="section-heading">
              <div><span className="section-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Continue Watching</h2><p>Your recently played channels.</p></div>
              <button className="view-all focusable" type="button" onClick={() => { setRecentChannels([]); localStorage.removeItem("streambox-recent"); }}>CLEAR HISTORY</button>
            </div>
            <div className="channel-grid">
              {recentChannels.map((channel, index) => <ChannelCard key={`recent-${channel.id}-${index}`} channel={channel} onPlay={playChannel} index={index} />)}
            </div>
          </section>
        )}

        <section className="content-section browse-section" id="browse">
          <div className="section-heading">
            <div><span className="section-kicker">FIND YOUR NEXT WATCH</span><h2>Browse StreamBox</h2><p>Choose a category or search for a channel.</p></div>
            <div className="channel-count">{channels.length.toLocaleString()} CHANNELS</div>
          </div>

          <div className="browse-toolbar">
            <div className="search-box">
              <span aria-hidden="true">⌕</span>
              <input className="focusable" type="search" placeholder="Search movies, FOX Sports, Canal+..." value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }} aria-label="Search channels" />
              {search && <button className="focusable" type="button" onClick={() => setSearch("")} aria-label="Clear search">✕</button>}
            </div>
            {(activeCategory !== "All" || search) && <button className="reset-filters focusable" type="button" onClick={resetFilters}>↺ RESET FILTERS</button>}
          </div>

          <div className="category-list" aria-label="Channel categories">
            {CATEGORIES.map((category) => <button key={category} type="button" className={`category focusable ${activeCategory === category ? "active" : ""}`} aria-pressed={activeCategory === category} onClick={() => { setActiveCategory(category); setVisibleCount(PAGE_SIZE); }}>{category}</button>)}
          </div>

          {loading && channels.length === 0 && <div className="message-panel"><div className="loader" /><h3>Getting StreamBox ready</h3><p>Loading channels. They will appear as soon as they are available.</p></div>}
          {error && <div className="message-panel"><h3>Could not load channels</h3><p>{error}</p><button className="hero-button focusable" type="button" onClick={fetchPlaylist}>TRY AGAIN</button></div>}

          {!error && channels.length > 0 && search && (
            <div className="channel-section">
              <div className="row-heading"><div><h2>Search results</h2><p>{filteredChannels.length.toLocaleString()} matches</p></div></div>
              {filteredChannels.length ? renderGrid(filteredChannels, visibleCount) : <div className="empty-state">No channels found. Try another search.</div>}
            </div>
          )}

          {!error && channels.length > 0 && !search && activeCategory !== "All" && (
            <div className="channel-section">
              <div className="row-heading"><div><h2>{activeCategory}</h2><p>{filteredChannels.length.toLocaleString()} channels available</p></div></div>
              {filteredChannels.length ? renderGrid(filteredChannels, visibleCount) : <div className="empty-state">No channels found in this category.</div>}
            </div>
          )}

          {!error && channels.length > 0 && !search && activeCategory === "All" && (
            <>
              {CATEGORIES.slice(1).map((category) => {
                const items = categoryGroups[category] || [];
                if (!items.length) return null;
                return (
                  <div className="channel-section" id={category === "Sport" ? "sports" : undefined} key={category}>
                    <div className="row-heading"><div><h2>{category === "Sport" ? "Sports & Live Action" : category}</h2><p>{items.length.toLocaleString()} channels</p></div><button className="view-all focusable" type="button" onClick={() => { setActiveCategory(category); setVisibleCount(PAGE_SIZE); document.getElementById("browse")?.scrollIntoView({ behavior: "smooth" }); }}>VIEW ALL →</button></div>
                    <div className="channel-grid">{items.slice(0, 8).map((channel, index) => <ChannelCard key={`${channel.id}-${index}`} channel={channel} onPlay={playChannel} index={index} />)}</div>
                  </div>
                );
              })}
            </>
          )}
          {!loading && !error && channels.length > 0 && <div className="playlist-note">Playlist updated from IPTV-org · Some streams depend on their original providers.</div>}
        </section>
      </main>

      <footer className="footer"><a className="brand focusable" href="#home"><span className="brand-icon">S</span><span>STREAM<span>BOX</span></span></a><p>Your entertainment, all in one place.</p><span>Only use streams you are authorized to access.</span></footer>

      {selectedChannel && (
        <div className="player-backdrop" onClick={closePlayer} role="presentation">
          <section className="player-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Playing ${selectedChannel.name}`}>
            <div className="player-header">
              <div className="player-title"><span className="player-live-dot" /> NOW PLAYING<h2>{selectedChannel.name}</h2></div>
              <div className="player-header-actions">
                <button className="back-home-player focusable" type="button" onClick={closePlayer}>← BACK TO {activeCategory === "All" ? getCategory(selectedChannel).toUpperCase() : activeCategory.toUpperCase()}</button>
                <button className="close-player focusable" type="button" onClick={closePlayer} aria-label="Close player">✕</button>
              </div>
            </div>
            <div className="video-container">
              <video ref={videoRef} controls autoPlay playsInline className="video-player" />
              {playerError && <div className="player-error"><div className="error-icon">!</div><h3>Stream unavailable</h3><p>{playerError}</p><button className="hero-button focusable" type="button" onClick={() => { setPlayerError(""); setRetryKey((value) => value + 1); }}>RETRY STREAM</button></div>}
            </div>
            <div className="player-footer"><span>{selectedChannel.group || getCategory(selectedChannel)}</span><span>STREAMBOX PLAYER</span></div>
          </section>
        </div>
      )}
    </div>
  );
}
