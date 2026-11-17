function Navbar({ search, setSearch }) {
  return (
    <header className="navbar">
      <div className="mobile-logo">
        Stream<span>Box</span>
      </div>

      <div className="search-box">
        <span>🔎</span>

        <input
          type="text"
          placeholder="Search channels, movies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="nav-actions">
        <button className="notification">🔔</button>

        <div className="profile">
          <div className="avatar">U</div>

          <div>
            <strong>User</strong>
            <small>Premium</small>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;