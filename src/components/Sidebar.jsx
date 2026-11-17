function Sidebar({ activeCategory, setActiveCategory }) {
  const categories = [
    { name: "Home", icon: "⌂" },
    { name: "Live TV", icon: "📺" },
    { name: "Movies", icon: "🎬" },
    { name: "Sports", icon: "⚽" },
    { name: "Entertainment", icon: "🎵" },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        Stream<span>Box</span>
      </div>

      <div className="menu">
        {categories.map((item) => (
          <button
            key={item.name}
            className={
              activeCategory === item.name
                ? "menu-item active"
                : "menu-item"
            }
            onClick={() => setActiveCategory(item.name)}
          >
            <span>{item.icon}</span>
            {item.name}
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <button className="menu-item">
          ⚙️ Settings
        </button>

        <button className="menu-item">
          🚪 Logout
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;