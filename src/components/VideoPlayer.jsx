```jsx
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

function VideoPlayer({ channel }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!channel?.streamUrl || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    let hls;

    setError("");

    if (Hls.isSupported()) {
      hls = new Hls();

      hls.loadSource(channel.streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          // Browser autoplay policies may require user interaction.
        });
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError("Unable to play this stream.");
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.streamUrl;

      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
      });
    } else {
      setError("HLS playback is not supported by this browser.");
    }

    return () => {
      if (hls) {
        hls.destroy();
      }

      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [channel]);

  if (!channel) {
    return (
      <section className="video-player">
        <div className="player-background">
          <div className="player-content">
            <div className="play-button">▶</div>

            <h2>Select a Channel</h2>

            <p>
              Choose a channel below to start watching.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="video-player">
      <div className="real-player">
        <video
          ref={videoRef}
          controls
          playsInline
          className="video-element"
        />

        {error && (
          <div className="video-error">
            {error}
          </div>
        )}
      </div>

      <div className="player-info">
        <div>
          <span className="live-indicator">● LIVE</span>

          <h2>{channel.name}</h2>

          <p>{channel.description}</p>
        </div>

        <span className="player-category">
          {channel.category}
        </span>
      </div>
    </section>
  );
}

export default VideoPlayer;
```
