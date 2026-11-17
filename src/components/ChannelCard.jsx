function ChannelCard({ channel, onSelect }) {
  return (
    <div
      className="channel-card"
      onClick={() => onSelect(channel)}
    >
      <div className="channel-image">
        <span className="live-badge">LIVE</span>

        <div className="channel-logo">
          {channel.logo}
        </div>
      </div>

      <div className="channel-info">
        <h3>{channel.name}</h3>

        <p>{channel.category}</p>
      </div>
    </div>
  );
}

export default ChannelCard;