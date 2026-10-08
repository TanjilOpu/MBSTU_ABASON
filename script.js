import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import { getFirestore, collection, doc, addDoc, setDoc, deleteDoc, getDoc, getDocs, query, orderBy, where, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { getAuth, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, onAuthStateChanged, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC7wiVBHHzaNzdzSrCTPBfG-7CyrJuBtO4",
  authDomain: "mbstu-mess-finder.firebaseapp.com",
  projectId: "mbstu-mess-finder",
  storageBucket: "mbstu-mess-finder.firebasestorage.app",
  messagingSenderId: "565571283956",
  appId: "1:565571283956:web:a1f64bab63adc76afc67a1",
  measurementId: "G-ZCERX114LW"
};

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

const auth = getAuth(app);

const EJS_PUBLIC_KEY = "0WTBkn2BFt8OzJItP";
const EJS_SERVICE_ID = "service_kj26sun";
const EJS_TEMPLATE_ID = "template_urzypx9";

const OWNERS_COL = "owners";

const MESSES_COL = "messes";
const VISITORS_COL = "visitors";

// New: mess ratings/reviews, and abuse reports against listings.
const REVIEWS_COL = "reviews";
const REPORTS_COL = "reports";
const REVIEW_PRIVATE_COL = "reviewPrivate";

// A proper email-format check (covers things like missing "@", missing
// domain, illegal characters, no dot in the domain, etc.) — much stricter
// than the old ".includes('@') && .includes('.')" check, which let almost
// anything through (e.g. "a@b" or "@@..").
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
function isValidEmail(email) {
  return EMAIL_REGEX.test(String(email || "").trim());
}

let currentOwner = null;

let currentVisitor = null;

let currentAdmin = false;

async function hasAdminClaim(user = auth.currentUser) {
  if (!user || !user.emailVerified) return false;
  const tokenResult = await getIdTokenResult(user, true);
  return tokenResult.claims.admin === true;
}

let pendingDeleteId = null;

let pendingDeleteType = null;

let pendingOwnerDeleteId = null;

let pendingReportDeleteId = null;

let _currentImages = [];
let _adminCurrentImages = []; // photos currently shown in the Admin Edit Mess photo-management grid

let _allMesses = [];
let _allReviews = []; // cache of every review, used to show each card's average rating without extra queries

let _allOwners = [];

function updateHeader() {
  const ownerLoggedIn = !!currentOwner;
  const adminLoggedIn = !!currentAdmin;
  const visitorLoggedIn = !!currentVisitor;
  const anyLoggedIn = ownerLoggedIn || adminLoggedIn || visitorLoggedIn;
  document.getElementById("hdr_ownerLogin").style.display = anyLoggedIn ? "none" : "";
  document.getElementById("hdr_admin").style.display = anyLoggedIn ? "none" : "";
  document.getElementById("hdr_register").style.display = anyLoggedIn ? "none" : "";
  document.getElementById("hdr_myProfile").style.display = ownerLoggedIn ? "" : "none";
  document.getElementById("hdr_adminProfile").style.display = adminLoggedIn ? "" : "none";
  document.getElementById("hdr_logout").style.display = anyLoggedIn ? "" : "none";
  const visitorLogin = document.getElementById("hdr_visitorLogin");
  if (visitorLogin) visitorLogin.style.display = visitorLoggedIn || anyLoggedIn ? "none" : "";
  updateActiveHeaderButton();
}

function updateActiveHeaderButton(activePage = null) {
  const page = activePage || (() => {
    const activePageEl = document.querySelector(".page.active");
    if (!activePageEl) return "browse";
    return activePageEl.id.replace("page-", "");
  })();

  const buttons = document.querySelectorAll(".btn");
  buttons.forEach(btn => btn.classList.remove("active"));

  const buttonMap = {
    browse: document.getElementById("hdr_browse"),
    ownerDashboard: document.getElementById("hdr_myProfile"),
    adminDashboard: document.getElementById("hdr_adminProfile") || document.getElementById("hdr_admin"),
    adminLogin: document.getElementById("hdr_admin"),
    ownerLogin: document.getElementById("hdr_ownerLogin"),
    ownerRegister: document.getElementById("hdr_register"),
    visitorLogin: document.getElementById("hdr_visitorLogin")
  };

  const targetBtn = buttonMap[page];
  if (targetBtn) {
    targetBtn.classList.add("active");
  }
}

window.updateHeader = updateHeader;
window.updateActiveHeaderButton = updateActiveHeaderButton;

function handleHeaderLogout() {
  if (currentAdmin) logoutAdmin(); else if (currentOwner) logoutOwner(); else if (currentVisitor) logoutVisitor();
}

window.handleHeaderLogout = handleHeaderLogout;

function hideLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = "none";
}

function showPage(name, pushState = true) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const target = document.getElementById("page-" + name);
  if (target) {
    target.classList.add("active");
    target.classList.remove("page-fade-in");
    void target.offsetWidth;
    target.classList.add("page-fade-in");
  }
  document.getElementById("heroSection").style.display = name === "browse" ? "" : "none";
  const searchBtn = document.getElementById("searchMessesBtn");
  if (searchBtn) searchBtn.classList.remove("active");
  if (name === "browse") loadAndRenderMesses();
  if (name === "ownerDashboard") renderOwnerDashboard();
  if (name === "adminDashboard") renderAdminDashboard();
  updateActiveHeaderButton(name);
  if (pushState) {
    history.pushState({
      page: name
    }, "", "#" + name);
  }
  window.scrollTo(0, 0);
}

window.showPage = showPage;

window.addEventListener("popstate", function(e) {
  const page = e.state && e.state.page ? e.state.page : "browse";
  if (page === "ownerDashboard" && !currentOwner) {
    showPage("ownerLogin", false);
    return;
  }
  if (page === "adminDashboard" && !currentAdmin) {
    showPage("adminLogin", false);
    return;
  }
  showPage(page, false);
});

function skeletonCardsHTML(count = 6) {
  return Array.from({
    length: count
  }).map(() => `\n    <div class="mess-card skeleton-card">\n      <div class="skeleton-block skeleton-thumb"></div>\n      <div class="card-compact">\n        <div class="skeleton-block skeleton-line" style="width:70%"></div>\n        <div class="skeleton-block skeleton-line" style="width:40%;margin-top:8px"></div>\n        <div class="skeleton-block skeleton-line" style="width:55%;margin-top:14px"></div>\n      </div>\n    </div>\n  `).join("");
}

async function loadAndRenderMesses() {
  document.getElementById("messGrid").innerHTML = skeletonCardsHTML();
  try {
    const q = query(collection(db, MESSES_COL), orderBy("createdAt", "desc"));
    // Fetch messes AND every review together — one review query up front is
    // far cheaper than querying reviews separately per card, and lets every
    // card show its average rating immediately.
    const [snap] = await Promise.all([getDocs(q), loadAllReviews()]);
    _allMesses = snap.docs.map(d => ({
      firestoreId: d.id,
      ...d.data()
    }));
    renderMesses(_allMesses);
    const heroStat = document.getElementById("heroStatTotal");
    if (heroStat) heroStat.textContent = _allMesses.length;
  } catch (e) {
    console.error(e);
    document.getElementById("messGrid").innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Could not load messes</h3><p>Check your Firebase config or internet connection.</p></div>`;
  }
}

// Fetches EVERY review once (cheap for a small student-project dataset)
// so we can compute each mess's average rating client-side instead of
// running a separate database query per card.
async function loadAllReviews() {
  try {
    const snap = await getDocs(collection(db, REVIEWS_COL));
    _allReviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
    _allReviews = _allReviews || [];
  }
}

// Returns { avg, count } for one mess, computed from the cached _allReviews.
function getMessRatingSummary(messId) {
  const reviews = (_allReviews || []).filter(r => r.messId === messId);
  if (reviews.length === 0) return { avg: 0, count: 0 };
  const avg = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
  return { avg: avg, count: reviews.length };
}

// Opens a mess's detail popup and scrolls straight down to the Ratings &
// Reviews section — used by the clickable rating badge on each card.
function openDetailModalToReviews(messId) {
  window._currentModalMessId = messId;
  window._reviewsReturnToDetail = false;
  showAllReviewsForMess();
}
window.openDetailModalToReviews = openDetailModalToReviews;


function applyFilters() {
  const searchBtn = document.getElementById("searchMessesBtn");
  if (searchBtn) {
    searchBtn.classList.add("active");
    clearTimeout(searchBtn._activeTimer);
    searchBtn._activeTimer = setTimeout(() => searchBtn.classList.remove("active"), 500);
  }

  const type = document.getElementById("f_type").value;
  const loc = document.getElementById("f_location").value;
  const maxRent = parseInt(document.getElementById("f_rent").value) || 0;
  const maxDist = parseInt(document.getElementById("f_distance").value) || 0;
  // FIX: this used to default to 1 and was applied unconditionally, which
  // silently hid EVERY mess with 0 seats available this month from EVERY
  // search (even ones that only filtered by type/location and never
  // touched "Min Seats"). Now it defaults to 0 ("no restriction") and is
  // only enforced when the user actually types a value > 0, matching how
  // maxRent/maxDist already behave below.
  const minSeats = parseInt(document.getElementById("f_seats").value) || 0;
  const wifi = document.getElementById("f_wifi").value;
  const gas = document.getElementById("f_gas").value;
  const meal = document.getElementById("f_meal").value;
  const single = document.getElementById("f_single").value;
  let filtered = _allMesses.filter(m => {
    // FIX: normalize with trim()/toUpperCase() so stray whitespace or
    // inconsistent casing in older stored records can't silently break
    // the Boys/Girls or Town/Santosh/Kagmari match.
    if (type && String(m.type || "").trim().toUpperCase() !== type) return false;
    if (loc && String(m.location || "").trim().toUpperCase() !== loc) return false;
    if (maxRent > 0 && m.rent > maxRent) return false;
    if (maxDist > 0 && m.distance > maxDist) return false;
    if (minSeats > 0 && m.seats < minSeats) return false;
    if (wifi && String(m.wifi) !== wifi) return false;
    if (gas && String(m.gas) !== gas) return false;
    if (meal && String(m.meal) !== meal) return false;
    if (single && String(m.single) !== single) return false;
    return true;
  });
  filtered.sort((a, b) => a.distance - b.distance || a.rent - b.rent);
  renderMesses(filtered);
}

window.applyFilters = applyFilters;

function resetFilters() {
  [ "f_type", "f_location", "f_wifi", "f_gas", "f_meal", "f_single" ].forEach(id => document.getElementById(id).value = "");
  [ "f_rent", "f_distance", "f_seats" ].forEach(id => document.getElementById(id).value = "");
  renderMesses(_allMesses);
}

window.resetFilters = resetFilters;

function renderMesses(messes, container = "messGrid", ownerMode = false, adminMode = false) {
  const grid = document.getElementById(container);
  const countEl = document.getElementById("resultsCount");
  if (!grid) return;
  if (countEl && !ownerMode && !adminMode) {
    countEl.innerHTML = `Showing <strong>${messes.length}</strong> of <strong>${_allMesses.length}</strong> listings`;
  }
  if (messes.length === 0) {
    grid.innerHTML = `\n      <div class="empty-state">\n        <div class="icon">🏠</div>\n        <h3>${ownerMode ? "No Listings Yet" : adminMode ? "No Messes Found" : "No Messes Found"}</h3>\n        <p>${ownerMode ? 'Click "+ Add New Mess" to list your first property.' : "Try adjusting your filters or check back later."}</p>\n      </div>`;
    return;
  }
  grid.innerHTML = messes.map(m => {
    const thumbSrc = m.images && m.images.length > 0 ? m.images[0] : m.imageData || null;
    return `\n    <div class="mess-card ${m.type.toLowerCase()} ${adminMode ? "admin-card" : ""}">\n      ${adminMode ? `<div class="admin-card-banner">🛡️ Admin View · Owner: ${esc(m.ownerName || "Unknown")}</div>` : ""}\n      <div class="card-thumb">\n        ${thumbSrc ? `<img src="${thumbSrc}" alt="${esc(m.name)}" loading="lazy">` : `<div class="card-thumb-placeholder">${m.type === "GIRLS" ? "🏠" : "🏢"}</div>`}\n        <span class="card-thumb-type ${m.type.toLowerCase()}">${m.type}</span>\n      </div>\n      <div class="card-compact">\n        <div class="card-top">\n          <div>\n            <div class="card-name">${esc(m.name)}</div>\n            <div class="card-id-text">${esc(m.location)}</div>\n          </div>\n        </div>\n        <div class="card-meta">\n          <span class="card-location-text">\n            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>\n              <circle cx="12" cy="10" r="3"/>\n            </svg>\n            ${esc(m.address)}\n          </span>\n          <span class="distance-chip">📍 ${m.distance}m</span>\n        </div>\n        <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">\n          <div class="card-rent-small">${m.rent.toLocaleString()} <span>BDT/seat/mo</span></div>${(() => { const rs = getMessRatingSummary(m.firestoreId); return rs.count > 0 ? `<span class="card-rating-badge" onclick="openDetailModalToReviews('${m.firestoreId}')">★ ${rs.avg.toFixed(1)} <span class="rc">(${rs.count})</span></span>` : `<span class="card-rating-badge no-rating" onclick="openDetailModalToReviews('${m.firestoreId}')">☆ No ratings yet</span>`; })()}\n        </div>\n      </div>\n      <div class="card-footer">\n        <span class="seats-info">🛏️ <strong>${m.seats}</strong> seats available (this month)</span>\n        <button class="btn-details" onclick="openDetailModal('${m.firestoreId}')">See Details →</button>\n      </div>\n      ${ownerMode ? `\n      <div class="owner-card-actions">\n        <button class="btn btn-blue btn-sm" onclick="editMess('${m.firestoreId}')">✏️ Edit</button>\n        <button class="btn btn-danger btn-sm" onclick="openDeleteModal('${m.firestoreId}', '${esc(m.name)}', false)">🗑️ Delete</button>\n      </div>` : ""}\n      ${adminMode ? `\n      <div class="owner-card-actions">\n        <button class="btn btn-admin btn-sm" onclick="adminEditMess('${m.firestoreId}')">🛡️ Edit</button>\n        <button class="btn btn-danger btn-sm" onclick="openDeleteModal('${m.firestoreId}', '${esc(m.name)}', true)">🗑️ Delete</button>\n      </div>` : ""}\n    </div>\n  `;
  }).join("");
}

function openDetailModal(firestoreId) {
  const m = _allMesses.find(x => x.firestoreId === firestoreId);
  if (!m) return;
  const images = m.images && m.images.length > 0 ? m.images : m.imageData ? [ m.imageData ] : [];
  const galleryHTML = images.length > 0 ? `\n    <div class="gallery-wrap">\n      <div class="gallery-main">\n        <img id="galleryMainImg" src="${images[0]}" alt="${esc(m.name)}">\n        ${images.length > 1 ? `\n          <button class="gallery-arrow left" onclick="galleryNav(-1)">&#8249;</button>\n          <button class="gallery-arrow right" onclick="galleryNav(1)">&#8250;</button>\n          <div class="gallery-counter" id="galleryCounter">1 / ${images.length}</div>\n        ` : ""}\n      </div>\n      ${images.length > 1 ? `\n        <div class="gallery-thumbs">\n          ${images.map((src, i) => `\n            <img src="${src}" class="gallery-thumb ${i === 0 ? "active" : ""}"\n              onclick="galleryGoTo(${i})" alt="Photo ${i + 1}">\n          `).join("")}\n        </div>\n      ` : ""}\n    </div>\n  ` : `<div class="modal-img-placeholder">${m.type === "GIRLS" ? "🏩" : "🏠"}</div>`;
  document.getElementById("detailModalContent").innerHTML = `\n    ${galleryHTML}\n    <div class="modal-body">\n      <div class="modal-header">\n        <div>\n          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">\n            <span class="type-badge ${m.type.toLowerCase()}">${m.type}</span>\n            <span style="font-size:0.72rem;color:var(--muted)">${esc(m.location)}</span>\n          </div>\n          <div class="modal-title">${esc(m.name)}</div>\n        </div>\n        <button class="modal-close" onclick="closeDetailModal()">✕</button>\n      </div>\n      <div class="modal-rent">${m.rent.toLocaleString()} <span>BDT / seat / month</span></div>\n      <div class="modal-location">\n        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>\n          <circle cx="12" cy="10" r="3"/>\n        </svg>\n        ${esc(m.address)} &nbsp;·&nbsp; ${esc(m.location)}\n        <span class="distance-chip">📍 ${m.distance}m from MBSTU</span>\n      </div>\n      <div class="detail-section">\n        <div class="detail-section-title">Room Details</div>\n        <div class="detail-grid">\n          <div class="detail-item"><div class="d-label">Building Type</div><div class="d-value">${m.buildingType === "TINSHED" ? "Tin-shed" : "Building"}</div></div>\n          <div class="detail-item"><div class="d-label">People / Room</div><div class="d-value">Max ${m.ppr}</div></div>\n          <div class="detail-item"><div class="d-label">Electricity Lines</div><div class="d-value">${m.elec}</div></div>\n          <div class="detail-item"><div class="d-label">Distance</div><div class="d-value">${m.distance}m</div></div>\n          ${m.single ? `<div class="detail-item"><div class="d-label">Single Seat Cost</div><div class="d-value">${m.singleCost.toLocaleString()} BDT</div></div>` : ""}\n          ${m.meal ? `<div class="detail-item"><div class="d-label">Meals Per Day</div><div class="d-value">${m.mealsDay}</div></div>` : ""}\n        </div>\n      </div>\n      <div class="detail-section">\n        <div class="detail-section-title">Seat Availability</div>\n        <div class="detail-grid">\n          <div class="detail-item"><div class="d-label">This Month · Single Room</div><div class="d-value">${m.seatsSingleThisMonth != null ? m.seatsSingleThisMonth : 0}</div></div>\n          <div class="detail-item"><div class="d-label">This Month · Shared Room</div><div class="d-value">${m.seatsMultiThisMonth != null ? m.seatsMultiThisMonth : m.seats}</div></div>\n          <div class="detail-item"><div class="d-label">Next Month · Single Room</div><div class="d-value">${m.seatsSingleNextMonth != null ? m.seatsSingleNextMonth : 0}</div></div>\n          <div class="detail-item"><div class="d-label">Next Month · Shared Room</div><div class="d-value">${m.seatsMultiNextMonth != null ? m.seatsMultiNextMonth : 0}</div></div>\n        </div>\n      </div>\n      <div class="detail-section">\n        <div class="detail-section-title">Amenities</div>\n        <div class="chips-row">\n          <span class="chip ${m.wifi ? "on" : "off"}">${m.wifi ? "✓" : "✗"} WiFi</span>\n          <span class="chip ${m.gas ? "on" : "off"}">${m.gas ? "✓" : "✗"} Gas</span>\n          <span class="chip ${m.tiled ? "on" : "off"}">${m.tiled ? "✓" : "✗"} Tiled Room</span>\n          <span class="chip ${m.meal ? "on" : "off"}">${m.meal ? "✓ Meals (" + m.mealsDay + "/day)" : "✗ No Meals"}</span>\n          <span class="chip ${m.single ? "on" : "off"}">${m.single ? "✓ Single Seat" : "✗ No Single"}</span>\n        </div>\n      </div>\n      <div class="detail-section">
        <div class="detail-section-title">Ratings &amp; Reviews</div>
        <div id="inlineReviewsSummary" class="rating-summary"></div>
        <button class="btn btn-ghost btn-sm reviews-see-all" type="button" onclick="showAllReviewsForMess()">See All Reviews</button>
        <div id="inlineReviewsList"></div>
        <div class="review-form">
          <div class="detail-section-title" style="margin-top:14px;font-size:0.82rem">Add Your Review</div>
          <div class="star-rating" id="inlineReviewStarPicker">
            <span class="star" data-n="1" onclick="setReviewStars(1)">★</span>
            <span class="star" data-n="2" onclick="setReviewStars(2)">★</span>
            <span class="star" data-n="3" onclick="setReviewStars(3)">★</span>
            <span class="star" data-n="4" onclick="setReviewStars(4)">★</span>
            <span class="star" data-n="5" onclick="setReviewStars(5)">★</span>
          </div>
          <input type="hidden" id="inlineReviewRating" value="0">
          <textarea id="inlineReviewComment" placeholder="Share your experience with this mess (what's good, what to watch out for)..." style="margin-top:8px;min-height:70px"></textarea>
          <div class="form-error" id="inlineReviewError"></div>
          <div class="form-success" id="inlineReviewSuccess"></div>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="submitReview()">Submit Review</button>
        </div>
      </div>
      <div class="modal-contact">📞 Contact Owner: <strong>${esc(m.contact)}</strong></div>\n      ${m.mapLink ? `<a href="${esc(m.mapLink)}" target="_blank" rel="noopener" class="btn btn-green btn-sm" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;text-decoration:none">📍 View on Google Maps</a>` : ""}\n      ${m.desc ? `<div class="modal-desc">${esc(m.desc)}</div>` : ""}\n      <button class="btn btn-ghost btn-sm report-btn" onclick="openReportModal(\'${m.firestoreId}\', \'${esc(m.name)}\')">🚩 Report This Mess</button>\n    </div>\n  `;
  document.getElementById("detailModalContent").innerHTML = document.getElementById("detailModalContent").innerHTML
    .replace(/Building Type/g, "House Type")
    .replace(/People \/ Room/g, "People Per Shared Room");
  window._galleryImages = images;
  window._galleryIndex = 0;
  // New: this mess's ID needs to be reachable by submitReview()/openReportModal()
  // after the visitor fills in the forms and clicks submit.
  window._currentModalMessId = m.firestoreId;
  setReviewStars(0);
  loadReviewsForMess(m.firestoreId);
  document.getElementById("detailModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

window.openDetailModal = openDetailModal;

function galleryGoTo(index) {
  const imgs = window._galleryImages || [];
  if (!imgs.length) return;
  window._galleryIndex = index;
  document.getElementById("galleryMainImg").src = imgs[index];
  const counter = document.getElementById("galleryCounter");
  if (counter) counter.textContent = index + 1 + " / " + imgs.length;
  document.querySelectorAll(".gallery-thumb").forEach((t, i) => t.classList.toggle("active", i === index));
}

window.galleryGoTo = galleryGoTo;

function galleryNav(dir) {
  const imgs = window._galleryImages || [];
  galleryGoTo((window._galleryIndex + dir + imgs.length) % imgs.length);
}

window.galleryNav = galleryNav;

function closeDetailModal(e) {
  if (e && e.target !== document.getElementById("detailModal")) return;
  document.getElementById("detailModal").classList.remove("open");
  document.body.style.overflow = "";
}

window.closeDetailModal = closeDetailModal;

function closeReviewsModal(e) {
  if (e && e.target !== document.getElementById("reviewsModal")) return;
  document.getElementById("reviewsModal").classList.remove("open");
  document.body.style.overflow = "";
  if (window._reviewsReturnToDetail && window._currentModalMessId) {
    openDetailModal(window._currentModalMessId);
  }
  window._reviewsReturnToDetail = false;
}

window.closeReviewsModal = closeReviewsModal;

function getCommunityIdentity() {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return null;
  if (currentVisitor) return { uid: user.uid, email: user.email, name: currentVisitor.name };
  if (currentOwner) return { uid: user.uid, email: user.email, name: currentOwner.name };
  if (currentAdmin) return { uid: user.uid, email: user.email, name: user.email };
  return null;
}

// ---- RATINGS & REVIEWS ------------------------------------------------
// Anyone browsing the site (no login required) can leave a star rating
// plus a short written review on any mess, visible to every other visitor.

let _reviewStars = 0; // which star count the visitor has currently picked (0 = none yet)

// Called when a visitor clicks one of the 5 stars in the review form.
// Fills in stars 1..n and leaves the rest empty.
function setReviewStars(n) {
  _reviewStars = n;
  ["review_rating", "inlineReviewRating"].forEach(id => {
    const hidden = document.getElementById(id);
    if (hidden) hidden.value = n;
  });
  document.querySelectorAll("#reviewStarPicker .star, #inlineReviewStarPicker .star").forEach(s => {
    s.classList.toggle("filled", parseInt(s.dataset.n, 10) <= n);
  });
}
window.setReviewStars = setReviewStars;

async function showAllReviewsForMess() {
  const messId = window._currentModalMessId;
  if (!messId) return;
  const mess = _allMesses.find(item => item.firestoreId === messId);
  if (!mess) return;
  window._reviewsReturnToDetail = document.getElementById("detailModal").classList.contains("open");
  document.getElementById("reviewsModalContent").innerHTML = `
    <div class="modal-body reviews-page-body">
      <div class="modal-header">
        <div>
          <div class="detail-section-title">Ratings &amp; Reviews</div>
          <div class="modal-title">${esc(mess.name)}</div>
        </div>
        <button class="modal-close" type="button" onclick="closeReviewsModal()" aria-label="Close reviews">✕</button>
      </div>
      <div id="reviewPageSummary" class="rating-summary"></div>
      <div id="reviewPageList" class="reviews-page-list"></div>
      <div class="review-form">
        <div class="detail-section-title" style="margin-top:14px;font-size:0.82rem">Add Your Review</div>
        <div class="star-rating" id="reviewStarPicker">
          <span class="star" data-n="1" onclick="setReviewStars(1)">★</span>
          <span class="star" data-n="2" onclick="setReviewStars(2)">★</span>
          <span class="star" data-n="3" onclick="setReviewStars(3)">★</span>
          <span class="star" data-n="4" onclick="setReviewStars(4)">★</span>
          <span class="star" data-n="5" onclick="setReviewStars(5)">★</span>
        </div>
        <input type="hidden" id="review_rating" value="0">
        <textarea id="review_comment" placeholder="Share your experience with this mess (what's good, what to watch out for)..." style="margin-top:8px;min-height:70px"></textarea>
        <div class="form-error" id="reviewError"></div>
        <div class="form-success" id="reviewSuccess"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="submitReview()">Submit Review</button>
      </div>
    </div>
  `;
  setReviewStars(0);
  document.getElementById("detailModal").classList.remove("open");
  document.getElementById("reviewsModal").classList.add("open");
  document.body.style.overflow = "hidden";
  await loadReviewsForMess(messId, "reviewPageSummary", "reviewPageList");
}

window.showAllReviewsForMess = showAllReviewsForMess;

// Fetches every review already left for this mess and renders the average
// rating + the full list of reviews inside the detail modal.
async function loadReviewsForMess(messId, summaryId = "reviewsSummary", listId = "reviewsList") {
  const summaryEl = document.getElementById(summaryId);
  const listEl = document.getElementById(listId);
  if (!summaryEl || !listEl) return;
  try {
    const q = query(collection(db, REVIEWS_COL), where("messId", "==", messId));
    const snap = await getDocs(q);
    const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentAdmin) {
      await Promise.all(reviews.map(async review => {
        const privateSnap = await getDoc(doc(db, REVIEW_PRIVATE_COL, review.id));
        if (privateSnap.exists()) Object.assign(review, privateSnap.data());
      }));
    }
    reviews.sort((a, b) => {
      const aTime = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
    if (reviews.length === 0) {
      summaryEl.innerHTML = `<span style="color:var(--muted)">No reviews yet — be the first to review this mess!</span>`;
      listEl.innerHTML = "";
      return;
    }
    const avg = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
    const rounded = Math.round(avg);
    summaryEl.innerHTML = `<span class="avg-stars">${"★".repeat(rounded)}${"☆".repeat(5 - rounded)}</span> <strong>${avg.toFixed(1)}</strong> out of 5 &middot; ${reviews.length} review${reviews.length > 1 ? "s" : ""}`;
    listEl.innerHTML = reviews.map(r => `
      <div class="review-card">
        <div class="review-header">
          <span class="review-stars">${"★".repeat(r.rating || 0)}${"☆".repeat(5 - (r.rating || 0))}</span>
          <span class="review-name">${esc(r.reviewerName || "Anonymous")}</span>
        </div>
        ${r.comment ? `<div class="review-comment">${esc(r.comment)}</div>` : ""}
        ${currentAdmin && r.reviewerEmail ? `<div class="review-contact">Reviewer: ${esc(r.reviewerName || "Unknown")} · ${esc(r.reviewerEmail)}</div>` : ""}
        ${currentAdmin ? `<button class="btn btn-danger btn-sm review-delete-btn" type="button" onclick="deleteReview('${r.id}')">🗑️ Remove Review</button>` : ""}
      </div>
    `).join("");
  } catch (e) {
    console.error(e);
    summaryEl.innerHTML = `<span style="color:var(--muted)">Could not load reviews right now.</span> <button class="btn btn-ghost btn-sm" type="button" onclick="showAllReviewsForMess()">Try Again</button>`;
  }
}

async function deleteReview(reviewId) {
  if (!currentAdmin || !reviewId) return;
  if (!confirm("Remove this review? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, REVIEWS_COL, reviewId));
    await deleteDoc(doc(db, REVIEW_PRIVATE_COL, reviewId));
    _allReviews = (_allReviews || []).filter(review => review.id !== reviewId);
    renderMesses(_allMesses);
    if (document.getElementById("page-adminDashboard").classList.contains("active")) {
      renderMesses(_allMesses, "adminMessGrid", false, true);
    }
    showToast("Review removed.", "success");
    await loadReviewsForMess(window._currentModalMessId, "reviewPageSummary", "reviewPageList");
  } catch (e) {
    console.error(e);
    showToast("Could not remove review.", "error");
  }
}

window.deleteReview = deleteReview;

// Saves a new review to Firestore for whichever mess is currently open in
// the detail modal, then refreshes the list so it shows up immediately.
async function submitReview() {
  const messId = window._currentModalMessId;
  if (!messId) return;
  const inlineForm = document.getElementById("detailModal").classList.contains("open");
  const fieldIds = inlineForm ? {
    rating: "inlineReviewRating",
    comment: "inlineReviewComment",
    error: "inlineReviewError",
    success: "inlineReviewSuccess"
  } : {
    rating: "review_rating",
    comment: "review_comment",
    error: "reviewError",
    success: "reviewSuccess"
  };
  const rating = parseInt(document.getElementById(fieldIds.rating).value, 10) || 0;
  const comment = document.getElementById(fieldIds.comment).value.trim();
  const errEl = document.getElementById(fieldIds.error);
  const sucEl = document.getElementById(fieldIds.success);
  errEl.style.display = "none";
  sucEl.style.display = "none";
  const identity = getCommunityIdentity();
  if (!identity) {
    showToast("Please log in with a verified email before submitting a review.", "error");
    document.getElementById("detailModal").classList.remove("open");
    document.getElementById("reviewsModal").classList.remove("open");
    document.body.style.overflow = "";
    window._reviewsReturnToDetail = false;
    showPage("visitorLogin");
    return;
  }
  if (rating < 1) {
    showFormError(errEl, "Please tap a star to give a rating.");
    return;
  }
  if (!comment) {
    showFormError(errEl, "Please write a short description of your experience.");
    return;
  }
  try {
    const reviewRef = doc(collection(db, REVIEWS_COL));
    const reviewData = {
      messId: messId,
      rating: rating,
      reviewerName: identity.name,
      reviewerUid: identity.uid,
      comment: comment,
      createdAt: serverTimestamp()
    };
    const batch = writeBatch(db);
    batch.set(reviewRef, reviewData);
    batch.set(doc(db, REVIEW_PRIVATE_COL, reviewRef.id), {
      reviewerUid: identity.uid,
      reviewerEmail: identity.email,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    sucEl.textContent = "✓ Thanks — your review has been posted!";
    sucEl.style.display = "block";
    document.getElementById(fieldIds.comment).value = "";
    setReviewStars(0);
    // Keep the local cache in sync immediately (no need to re-fetch the
    // whole collection) so the rating badge on the card behind this modal
    // is correct as soon as the modal is closed.
    _allReviews.push({ id: reviewRef.id, messId: messId, rating: rating, reviewerName: identity.name, comment: comment });
    const summaryId = inlineForm ? "inlineReviewsSummary" : "reviewPageSummary";
    const listId = inlineForm ? "inlineReviewsList" : "reviewPageList";
    await loadReviewsForMess(messId, summaryId, listId); // reload so the new review appears right away
  } catch (e) {
    console.error(e);
    const reason = e && e.code === "permission-denied"
      ? "Reviews are currently disabled by Firebase permissions."
      : "Could not submit your review. Check your connection and try again.";
    showFormError(errEl, reason);
  }
}
window.submitReview = submitReview;

// ---- REPORTING A LISTING ------------------------------------------------
// Lets any visitor flag a mess as fake or containing false information.
// Reports go into their own Firestore collection and show up grouped by
// mess on the admin dashboard so the admin can investigate and act.

let _pendingReportMessId = null;
let _pendingReportMessName = null;

// Opens the "Report This Mess" popup for a specific listing.
function openReportModal(messId, messName) {
  _pendingReportMessId = messId;
  _pendingReportMessName = messName;
  document.getElementById("reportMessName").textContent = messName;
  document.getElementById("report_reason").selectedIndex = 0;
  document.getElementById("report_fakeinfo").value = "";
  document.getElementById("report_details").value = "";
  document.getElementById("reportError").style.display = "none";
  document.getElementById("reportSuccess").style.display = "none";
  toggleReportFakeInfo();
  document.getElementById("reportModal").classList.add("open");
}
window.openReportModal = openReportModal;

// Shows the "Which information is fake?" box only when that reason is picked.
function toggleReportFakeInfo() {
  const isFakeInfo = document.getElementById("report_reason").value === "FAKE_INFO";
  document.getElementById("reportFakeInfoGroup").style.display = isFakeInfo ? "" : "none";
}
window.toggleReportFakeInfo = toggleReportFakeInfo;

function closeReportModal(e) {
  if (e && e.target !== document.getElementById("reportModal")) return;
  document.getElementById("reportModal").classList.remove("open");
}
window.closeReportModal = closeReportModal;

// Saves the report to Firestore, tagging it with the mess's current owner
// so the admin can act on the owner too if needed (e.g. repeated offenders).
async function submitReport() {
  if (!_pendingReportMessId) return;
  const reason = document.getElementById("report_reason").value;
  const fakeInfo = document.getElementById("report_fakeinfo").value.trim();
  const details = document.getElementById("report_details").value.trim();
  const errEl = document.getElementById("reportError");
  const sucEl = document.getElementById("reportSuccess");
  const btn = document.getElementById("reportSubmitBtn");
  errEl.style.display = "none";
  sucEl.style.display = "none";
  const identity = getCommunityIdentity();
  if (!identity) {
    showFormError(errEl, "Please log in with a verified email before submitting a report.");
    closeReportModal();
    showPage("visitorLogin");
    return;
  }
  if (reason === "FAKE_INFO" && !fakeInfo) {
    showFormError(errEl, "Please specify which information is fake (e.g. rent, photos, seats).");
    return;
  }
  if (!details) {
    showFormError(errEl, "Please describe the issue.");
    return;
  }
  const mess = _allMesses.find(x => x.firestoreId === _pendingReportMessId);
  btn.disabled = true;
  btn.textContent = "Submitting...";
  try {
    await addDoc(collection(db, REPORTS_COL), {
      messId: _pendingReportMessId,
      messName: _pendingReportMessName,
      ownerId: mess ? mess.ownerId : null,
      ownerName: mess ? mess.ownerName : null,
      reason: reason,           // "FAKE_MESS" | "FAKE_INFO" | "OTHER"
      fakeInfo: fakeInfo,       // only filled in when reason === "FAKE_INFO"
      details: details,
      reporterName: identity.name,
      reporterUid: identity.uid,
      reporterEmail: identity.email,
      status: "pending",        // becomes "resolved" once admin handles it
      createdAt: serverTimestamp()
    });
    sucEl.textContent = "✓ Report submitted. Our admin will review it.";
    sucEl.style.display = "block";
    showToast("Report submitted. Thank you.", "success");
    setTimeout(() => closeReportModal(), 1500);
  } catch (e) {
    console.error(e);
    showFormError(errEl, "Could not submit the report. Check your connection.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
}
window.submitReport = submitReport;

async function registerOwner() {
  const name = document.getElementById("reg_name").value.trim();
  const contact = document.getElementById("reg_contact").value.trim();
  const email = document.getElementById("reg_email").value.trim();
  const username = document.getElementById("reg_username").value.trim();
  const password = document.getElementById("reg_password").value;
  const confirm = document.getElementById("reg_confirm").value;
  const errEl = document.getElementById("regError");
  const sucEl = document.getElementById("regSuccess");
  errEl.style.display = "none";
  sucEl.style.display = "none";
  if (!name || !contact || !email || !username || !password) {
    showFormError(errEl, "Please fill all required fields.");
    return;
  }
  // FIX / NEW: properly validate the email format before creating the
  // account — tell the owner clearly if what they typed isn't a real
  // email address, instead of the old weak "@ and ." check.
  if (!isValidEmail(email)) {
    showFormError(errEl, "That doesn't look like a valid email address. Please enter a valid one, e.g. yourname@example.com.");
    return;
  }
  if (password.length < 6) {
    showFormError(errEl, "Password must be at least 6 characters.");
    return;
  }
  if (password !== confirm) {
    showFormError(errEl, "Passwords do not match.");
    return;
  }
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    localStorage.setItem("mbstu_pending_owner", JSON.stringify({
      uid: credential.user.uid,
      name: name,
      contact: contact,
      email: email,
      username: username.toLowerCase(),
    }));
    await sendEmailVerification(credential.user);
    await signOut(auth);
    sucEl.textContent = "Account created. Check your email, verify it, then log in.";
    sucEl.style.display = "block";
    setTimeout(() => showPage("ownerLogin"), 1500);
  } catch (e) {
    console.error(e);
    if (e && e.code === "auth/email-already-in-use") {
      try {
        const existingCredential = await signInWithEmailAndPassword(auth, email, password);
        if (await hasAdminClaim(existingCredential.user)) {
          await signOut(auth);
          showFormError(errEl, "This email is reserved for the administrator.");
          return;
        }
        const existingOwnerSnap = await getDoc(doc(db, OWNERS_COL, existingCredential.user.uid));
        const existingVisitorSnap = await getDoc(doc(db, VISITORS_COL, existingCredential.user.uid));
        if (existingOwnerSnap.exists()) {
          await signOut(auth);
          showFormError(errEl, "This email already has an active owner account. Please log in instead.");
          return;
        }
        if (existingVisitorSnap.exists()) {
          await signOut(auth);
          showFormError(errEl, "This email is being used as a User account and cannot also be an owner account.");
          return;
        }
        if (!existingCredential.user.emailVerified) {
          await sendEmailVerification(existingCredential.user);
          await signOut(auth);
          showFormError(errEl, "Please verify your email first. A new verification email was sent.");
          return;
        }
        await setDoc(doc(db, OWNERS_COL, existingCredential.user.uid), {
          uid: existingCredential.user.uid,
          name: name,
          contact: contact,
          email: email,
          username: username.toLowerCase(),
          createdAt: serverTimestamp()
        });
        await signOut(auth);
        sucEl.textContent = "Owner account recreated successfully. You can now log in.";
        sucEl.style.display = "block";
        setTimeout(() => showPage("ownerLogin"), 1500);
        return;
      } catch (reuseError) {
        console.error(reuseError);
        showFormError(errEl, "This email already exists. Use the original password or reset it before registering again.");
        if (auth.currentUser) await signOut(auth);
        return;
      }
    }
    showFormError(errEl, getFirebaseErrorMessage(e, "Could not create the account."));
    if (auth.currentUser && auth.currentUser.email === email) {
      await signOut(auth);
    }
  }
}

window.registerOwner = registerOwner;

async function registerVisitor() {
  const name = document.getElementById("visitor_reg_name").value.trim();
  const email = document.getElementById("visitor_reg_email").value.trim();
  const password = document.getElementById("visitor_reg_password").value;
  const confirm = document.getElementById("visitor_reg_confirm").value;
  const errEl = document.getElementById("visitorRegError");
  const sucEl = document.getElementById("visitorRegSuccess");
  errEl.style.display = "none";
  sucEl.style.display = "none";
  if (!name || !email || !password || !confirm) {
    showFormError(errEl, "Please fill all required fields.");
    return;
  }
  if (!isValidEmail(email)) {
    showFormError(errEl, "Please enter a valid email address.");
    return;
  }
  if (password.length < 6 || password !== confirm) {
    showFormError(errEl, password.length < 6 ? "Password must be at least 6 characters." : "Passwords do not match.");
    return;
  }
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, VISITORS_COL, credential.user.uid), {
      uid: credential.user.uid,
      name: name,
      email: email,
      createdAt: serverTimestamp()
    });
    await sendEmailVerification(credential.user);
    await signOut(auth);
    sucEl.textContent = "Account created. Check your email, verify it, then log in.";
    sucEl.style.display = "block";
  } catch (e) {
    console.error(e);
    showFormError(errEl, getFirebaseErrorMessage(e, "Could not create the community account."));
    if (auth.currentUser && auth.currentUser.email === email) await signOut(auth);
  }
}

window.registerVisitor = registerVisitor;

async function loginVisitor() {
  const email = document.getElementById("visitor_login_email").value.trim();
  const password = document.getElementById("visitor_login_password").value;
  const errEl = document.getElementById("visitorLoginError");
  errEl.style.display = "none";
  if (!isValidEmail(email) || !password) {
    showFormError(errEl, "Please enter your email and password.");
    return;
  }
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user);
      await signOut(auth);
      showFormError(errEl, "Please verify your email first. A new verification email was sent.");
      return;
    }
    const visitorSnap = await getDoc(doc(db, VISITORS_COL, credential.user.uid));
    if (!visitorSnap.exists()) {
      await signOut(auth);
      showFormError(errEl, "No community profile was found for this account.");
      return;
    }
    currentVisitor = { firestoreId: credential.user.uid, ...visitorSnap.data() };
    updateHeader();
    document.getElementById("visitor_login_email").value = "";
    document.getElementById("visitor_login_password").value = "";
    showPage("browse");
    showToast("Logged in as " + currentVisitor.name, "success");
  } catch (e) {
    console.error(e);
    showFormError(errEl, getFirebaseErrorMessage(e, "Could not log in."));
  }
}

window.loginVisitor = loginVisitor;


async function logoutVisitor() {
  await signOut(auth);
  currentVisitor = null;
  updateHeader();
  showPage("browse");
  showToast("Logged out successfully", "success");
}

window.logoutVisitor = logoutVisitor;

async function loginOwner() {
  const email = document.getElementById("login_username").value.trim();
  const password = document.getElementById("login_password").value;
  const errEl = document.getElementById("loginError");
  errEl.style.display = "none";
  if (!isValidEmail(email) || !password) {
    showFormError(errEl, "Please enter your registered email and password.");
    return;
  }
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (await hasAdminClaim(credential.user)) {
      await signOut(auth);
      showFormError(errEl, "Use the Admin Login page for the administrator account.");
      return;
    }
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user);
      await signOut(auth);
      showFormError(errEl, "Please verify your email first. A new verification email was sent.");
      return;
    }
    const ownerSnap = await getDoc(doc(db, OWNERS_COL, credential.user.uid));
    if (!ownerSnap.exists()) {
      const pending = JSON.parse(localStorage.getItem("mbstu_pending_owner") || "null");
      if (!pending || pending.uid !== credential.user.uid || pending.email !== email) {
        await signOut(auth);
        showFormError(errEl, "This Firebase account has no owner profile yet. Register again or contact the administrator.");
        return;
      }
      await setDoc(doc(db, OWNERS_COL, credential.user.uid), {
        ...pending,
        createdAt: serverTimestamp()
      });
      localStorage.removeItem("mbstu_pending_owner");
      currentOwner = { firestoreId: credential.user.uid, ...pending };
    } else {
      const ownerData = ownerSnap.data();
      currentOwner = {
        firestoreId: credential.user.uid,
        ...ownerData
      };
    }
    const ownerData = currentOwner;
    updateHeader();
    document.getElementById("ownerNameDisplay").textContent = ownerData.name;
    document.getElementById("ownerContactDisplay").textContent = ownerData.contact || "";
    document.getElementById("ownerEmailDisplay").textContent = ownerData.email || "";
    document.getElementById("login_username").value = "";
    document.getElementById("login_password").value = "";
    showPage("ownerDashboard");
    showToast("Logged in as " + ownerData.name, "success");
  } catch (e) {
    console.error(e);
    showFormError(errEl, getFirebaseErrorMessage(e, "Could not log in."));
  }
}

window.loginOwner = loginOwner;

function logoutOwner() {
  signOut(auth);
  currentOwner = null;
  updateHeader();
  showPage("browse");
  showToast("Logged out successfully", "success");
}

window.logoutOwner = logoutOwner;

async function sendPasswordResetLink(emailFieldId, errorId, successId, buttonId) {
  const emailField = document.getElementById(emailFieldId);
  const email = emailField.value.trim();
  const errEl = document.getElementById(errorId);
  const sucEl = document.getElementById(successId);
  const btn = document.getElementById(buttonId);
  errEl.style.display = "none";
  sucEl.style.display = "none";
  if (!isValidEmail(email)) {
    showFormError(errEl, "That doesn't look like a valid email address. Please enter a valid one, e.g. yourname@example.com.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    await sendPasswordResetEmail(auth, email);
    sucEl.textContent = "✓ If an account exists for this email, a password reset link has been sent.";
    sucEl.style.display = "block";
    emailField.value = "";
    showToast("Password reset email sent.", "success");
  } catch (e) {
    console.error(e);
    showFormError(errEl, getFirebaseErrorMessage(e, "Could not send the password reset email."));
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Password Reset Link";
  }
}

async function recoverOwnerAccount() {
  await sendPasswordResetLink("forgot_email", "forgotError", "forgotSuccess", "forgotBtn");
}

window.recoverOwnerAccount = recoverOwnerAccount;

async function recoverVisitorAccount() {
  await sendPasswordResetLink("visitor_forgot_email", "visitorForgotError", "visitorForgotSuccess", "visitorForgotBtn");
}

window.recoverVisitorAccount = recoverVisitorAccount;

function getFirebaseErrorMessage(error, fallback) {
  const code = error && error.code ? error.code : "";
  const messages = {
    "auth/email-already-in-use": "This email is already registered. Try logging in instead.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must contain at least 6 characters.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/user-not-found": "No Firebase account was found for this email.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/operation-not-allowed": "Email/password authentication is not enabled in Firebase.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The Firebase API key or project configuration is invalid.",
    "auth/unauthorized-domain": "This website domain is not authorized in Firebase Authentication.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "permission-denied": "Firestore rejected the profile write. Publish the final Firestore rules and try again.",
    "failed-precondition": "Firestore needs configuration before this operation can continue."
  };
  return messages[code] || (error && error.message ? `${fallback} (${code || "Firebase error"})` : fallback);
}

async function loginAdmin() {
  const email = document.getElementById("admin_username").value.trim();
  const password = document.getElementById("admin_password").value;
  const errEl = document.getElementById("adminLoginError");
  errEl.style.display = "none";
  if (!email || !password) {
    showFormError(errEl, "Please enter the admin email and password.");
    return;
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!(await hasAdminClaim(cred.user))) {
      await signOut(auth);
      showFormError(errEl, "This account is not authorized as admin.");
      return;
    }
    currentAdmin = true;
    currentOwner = null;
    currentVisitor = null;
    updateHeader();
    document.getElementById("admin_username").value = "";
    document.getElementById("admin_password").value = "";
    showPage("adminDashboard");
    showToast("Welcome, Admin!", "success");
  } catch (e) {
    console.error(e);
    showFormError(errEl, getFirebaseErrorMessage(e, "Could not log in."));
  }
}

window.loginAdmin = loginAdmin;

async function logoutAdmin() {
  await signOut(auth);
  showPage("browse");
  showToast("Admin logged out", "success");
}

window.logoutAdmin = logoutAdmin;

async function renderAdminDashboard() {
  if (!currentAdmin) {
    showPage("adminLogin");
    return;
  }
  const messSnap = await getDocs(query(collection(db, MESSES_COL), orderBy("createdAt", "desc")));
  _allMesses = messSnap.docs.map(d => ({
    firestoreId: d.id,
    ...d.data()
  }));
  const ownerSnap = await getDocs(collection(db, OWNERS_COL));
  _allOwners = ownerSnap.docs.map(d => ({
    firestoreId: d.id,
    ...d.data()
  }));
  // New: pull in every report so we can show a "Pending Reports" stat and
  // light up the Reports tab badge as soon as the admin dashboard opens.
  const reportSnap = await getDocs(collection(db, REPORTS_COL));
  const pendingReportCount = reportSnap.docs.filter(d => d.data().status !== "resolved").length;
  document.getElementById("adminStats").innerHTML = `\n    <div class="stat-card"><div class="num">${_allMesses.length}</div><div class="lbl">Total Messes</div></div>\n    <div class="stat-card"><div class="num">${_allOwners.length}</div><div class="lbl">Total Owners</div></div>\n    <div class="stat-card"><div class="num">${_allMesses.filter(m => m.type === "BOYS").length}</div><div class="lbl">Boys Messes</div></div>\n    <div class="stat-card"><div class="num">${_allMesses.filter(m => m.type === "GIRLS").length}</div><div class="lbl">Girls Messes</div></div>\n    <div class="stat-card"><div class="num" style="${pendingReportCount > 0 ? "color:var(--danger)" : ""}">${pendingReportCount}</div><div class="lbl">Pending Reports</div></div>\n  `;
  renderMesses(_allMesses, "adminMessGrid", false, true);
  renderOwnersTable();
  updateReportsTabBadge(pendingReportCount);
}

function switchAdminTab(tabName, btn) {
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-allMesses").style.display = tabName === "allMesses" ? "" : "none";
  document.getElementById("tab-allOwners").style.display = tabName === "allOwners" ? "" : "none";
  document.getElementById("tab-reports").style.display = tabName === "reports" ? "" : "none";
  if (tabName === "reports") renderReportsTab(); // fetch fresh report data only when the tab is actually opened
}

window.switchAdminTab = switchAdminTab;

// Shows/hides the little red count badge on the "🚩 Reports" nav tab.
function updateReportsTabBadge(count) {
  const badge = document.getElementById("reportsTabBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
}

// ---- ADMIN: REVIEW & ACT ON REPORTED MESSES --------------------------
// Builds the "🚩 Reports" tab: every report, grouped by mess, with a
// count per mess, so the admin can quickly see which listings are being
// flagged the most and decide what to do about them.
async function renderReportsTab() {
  const listEl = document.getElementById("reportsList");
  if (!listEl) return;
  listEl.innerHTML = `<p style="color:var(--muted);padding:24px;text-align:center">Loading reports...</p>`;
  try {
    const snap = await getDocs(query(collection(db, REPORTS_COL), orderBy("createdAt", "desc")));
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateReportsTabBadge(reports.filter(r => r.status !== "resolved").length);

    if (reports.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><div class="icon">🚩</div><h3>No Reports</h3><p>No mess has been reported yet — nice!</p></div>`;
      return;
    }

    // Group every report under its mess ID, so "3 reports on the same
    // mess" show up together as one card with a count, not 3 separate cards.
    const groups = {};
    reports.forEach(r => {
      if (!groups[r.messId]) groups[r.messId] = [];
      groups[r.messId].push(r);
    });

    // Show the messes with the most UNRESOLVED reports first — that's
    // where the admin's attention is needed most urgently.
    const groupEntries = Object.entries(groups).sort((a, b) => {
      const aPending = a[1].filter(r => r.status !== "resolved").length;
      const bPending = b[1].filter(r => r.status !== "resolved").length;
      return bPending - aPending || b[1].length - a[1].length;
    });

    const reasonLabel = r => {
      if (r.reason === "FAKE_MESS") return "🚩 Fake Mess";
      if (r.reason === "FAKE_INFO") return "⚠️ Fake Info: " + esc(r.fakeInfo || "unspecified");
      return "❓ Other";
    };

    listEl.innerHTML = groupEntries.map(([messId, group]) => {
      const first = group[0];
      const pendingCount = group.filter(r => r.status !== "resolved").length;
      const messStillExists = _allMesses.some(m => m.firestoreId === messId);
      return `
        <div class="report-group-card">
          <div class="report-group-header">
            <div>
              <div class="report-group-title">${esc(first.messName || "Unknown Mess")}${!messStillExists ? ' <span style="color:var(--muted);font-size:0.75rem">(listing already deleted)</span>' : ""}</div>
              <div class="report-group-sub">Owner: ${esc(first.ownerName || "Unknown")}</div>
            </div>
            <span class="report-badge">${pendingCount} pending &middot; ${group.length} total</span>
          </div>
          <div class="report-items">
            ${group.map(r => `
              <div class="report-item ${r.status === "resolved" ? "resolved" : ""}">
                <div class="report-item-top">
                  <span class="report-reason-tag">${reasonLabel(r)}</span>
                  <span class="report-status">${r.status === "resolved" ? "✓ Resolved" : "Pending"}</span>
                </div>
                <div class="report-details-text">${esc(r.details)}</div>
                <div class="report-contact">Reporter: ${esc(r.reporterName || "Unknown")} · ${esc(r.reporterEmail || r.reporterContact || "No email")}</div>
                <div class="report-item-actions">
                  ${r.status !== "resolved" ? `<button class="btn btn-ghost btn-sm" onclick="resolveReport('${r.id}')">Mark Resolved</button>` : `<button class="btn btn-danger btn-sm" onclick="openReportDeleteModal('${r.id}', '${esc(first.messName || "Unknown Mess")}')">🗑️ Delete Report</button>`}
                </div>
              </div>
            `).join("")}
          </div>
          <div class="report-group-actions">
            ${messStillExists ? `<button class="btn btn-primary btn-sm" onclick="adminEditMess('${messId}')">🔍 View &amp; Manage Mess</button>` : `<span style="color:var(--muted);font-size:0.82rem">This mess has already been deleted.</span>`}
            <button class="btn btn-ghost btn-sm" onclick="resolveAllReportsForMess('${messId}')">✅ Mark All Resolved</button>
          </div>
        </div>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
    listEl.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Could not load reports</h3><p>Check your connection and try again.</p></div>`;
  }
}
window.renderReportsTab = renderReportsTab;

// Marks a single report entry as handled (keeps it visible, but greyed out
// with a "✓ Resolved" tag, so there's a record of what was reported and dealt with).
async function resolveReport(reportId) {
  try {
    await setDoc(doc(db, REPORTS_COL, reportId), { status: "resolved", resolvedAt: serverTimestamp() }, { merge: true });
    showToast("Report marked resolved.", "success");
    renderReportsTab();
  } catch (e) {
    console.error(e);
    showToast("Error updating report.", "error");
  }
}
window.resolveReport = resolveReport;

function openReportDeleteModal(reportId, messName) {
  if (!currentAdmin) return;
  pendingReportDeleteId = reportId;
  document.getElementById("deleteReportMessName").textContent = messName;
  document.getElementById("reportDeleteModal").classList.add("open");
}

window.openReportDeleteModal = openReportDeleteModal;

async function confirmReportDelete() {
  if (!currentAdmin || !pendingReportDeleteId) return;
  try {
    await deleteDoc(doc(db, REPORTS_COL, pendingReportDeleteId));
    closeReportDeleteModal();
    pendingReportDeleteId = null;
    showToast("Report deleted.", "success");
    renderReportsTab();
  } catch (e) {
    console.error(e);
    showToast("Error deleting report.", "error");
  }
}

window.confirmReportDelete = confirmReportDelete;

function closeReportDeleteModal(e) {
  if (e && e.target !== document.getElementById("reportDeleteModal")) return;
  document.getElementById("reportDeleteModal").classList.remove("open");
}

window.closeReportDeleteModal = closeReportDeleteModal;

// Marks EVERY report against one mess as resolved in one click — handy once
// the admin has investigated and dealt with the underlying issue.
async function resolveAllReportsForMess(messId) {
  try {
    const snap = await getDocs(query(collection(db, REPORTS_COL), where("messId", "==", messId)));
    for (const d of snap.docs) {
      await setDoc(doc(db, REPORTS_COL, d.id), { status: "resolved", resolvedAt: serverTimestamp() }, { merge: true });
    }
    showToast("All reports for this mess marked resolved.", "success");
    renderReportsTab();
  } catch (e) {
    console.error(e);
    showToast("Error updating reports.", "error");
  }
}
window.resolveAllReportsForMess = resolveAllReportsForMess;

function adminSearchMesses() {
  const q = document.getElementById("adminSearchInput").value.toLowerCase();
  const filtered = _allMesses.filter(m => m.name.toLowerCase().includes(q) || m.ownerName && m.ownerName.toLowerCase().includes(q) || m.location.toLowerCase().includes(q) || m.address.toLowerCase().includes(q));
  renderMesses(filtered, "adminMessGrid", false, true);
}

window.adminSearchMesses = adminSearchMesses;

function renderOwnersTable() {
  const tbody = document.getElementById("ownersTableBody");
  const countEl = document.getElementById("broadcastCount");
  if (!tbody) return;
  const withEmail = _allOwners.filter(o => o.email);
  if (countEl) countEl.textContent = `${withEmail.length} of ${_allOwners.length} owners have email`;
  if (_allOwners.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px">No owners registered yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = _allOwners.map(o => {
    const listingCount = _allMesses.filter(m => m.ownerId === o.firestoreId).length;
    return `\n      <tr>\n        <td>${esc(o.name)}</td>\n        <td><span class="username-badge">${esc(o.username)}</span></td>\n        <td>${esc(o.contact)}</td>\n        <td>${o.email ? `<span class="email-badge">${esc(o.email)}</span>` : `<span style="color:var(--muted);font-size:0.78rem">No email</span>`}\n        </td>\n        <td><span class="listing-count">${listingCount}</span></td>\n        <td style="display:flex;gap:6px;flex-wrap:wrap">\n          ${o.email ? `<button class="btn btn-admin btn-sm" onclick="sendSingleEmail('${esc(o.email)}', '${esc(o.name)}')">📧 Email</button>` : ""}\n          <button class="btn btn-danger btn-sm" onclick="openOwnerDeleteModal('${o.firestoreId}', '${esc(o.name)}')">🗑️ Remove</button>\n        </td>\n      </tr>\n    `;
  }).join("");
}

function adminEditMess(firestoreId) {
  const m = _allMesses.find(x => x.firestoreId === firestoreId);
  if (!m) {
    showToast("Could not find listing.", "error");
    return;
  }
  document.getElementById("amf_editId").value = m.firestoreId;
  document.getElementById("amf_name").value = m.name;
  document.getElementById("amf_type").value = m.type;
  document.getElementById("amf_location").value = m.location;
  document.getElementById("amf_address").value = m.address;
  document.getElementById("amf_distance").value = m.distance;
  document.getElementById("amf_rent").value = m.rent;
  document.getElementById("amf_buildingtype").value = m.buildingType || "BUILDING";
  document.getElementById("amf_seats_single_this").value = m.seatsSingleThisMonth || 0;
  document.getElementById("amf_seats_multi_this").value = m.seatsMultiThisMonth != null ? m.seatsMultiThisMonth : m.seats || 0;
  document.getElementById("amf_seats_single_next").value = m.seatsSingleNextMonth || 0;
  document.getElementById("amf_seats_multi_next").value = m.seatsMultiNextMonth || 0;
  document.getElementById("amf_ppr").value = m.ppr;
  document.getElementById("amf_elec").value = m.elec;
  document.getElementById("amf_wifi").value = String(m.wifi);
  document.getElementById("amf_gas").value = String(m.gas);
  document.getElementById("amf_tiled").value = String(m.tiled);
  document.getElementById("amf_meal").value = String(m.meal);
  document.getElementById("amf_mealsday").value = m.mealsDay;
  document.getElementById("amf_single").value = String(m.single);
  document.getElementById("amf_singlecost").value = m.singleCost;
  document.getElementById("amf_maplink").value = m.mapLink || "";
  document.getElementById("amf_desc").value = m.desc || "";
  // New: load this mess's current photos into the admin photo-management grid.
  _adminCurrentImages = m.images && m.images.length > 0 ? m.images.slice() : m.imageData ? [m.imageData] : [];
  renderAdminImagePreviews();
  document.getElementById("adminMessFormTitle").textContent = "🛡️ Edit: " + m.name;
  toggleAdminMealInput();
  toggleAdminSingleInput();
  showPage("adminEditMess");
}

window.adminEditMess = adminEditMess;

// New: lets the admin instantly remove one sensitive/inappropriate photo
// from a listing. Unlike the rest of the edit form, this saves right away
// instead of waiting for "Save Changes" — flagged content shouldn't stay
// live just because the admin hasn't finished editing everything else yet.
async function adminRemoveImage(index) {
  const firestoreId = document.getElementById("amf_editId").value.trim();
  if (!firestoreId) return;
  if (!confirm("Remove this photo? This can't be undone.")) return;
  _adminCurrentImages.splice(index, 1);
  try {
    await setDoc(doc(db, MESSES_COL, firestoreId), {
      images: _adminCurrentImages.slice(),
      imageData: _adminCurrentImages[0] || ""
    }, { merge: true });
    // Keep the shared cache in sync so the Browse grid / detail modal
    // reflect the removal immediately, without a full page reload.
    const cached = _allMesses.find(x => x.firestoreId === firestoreId);
    if (cached) {
      cached.images = _adminCurrentImages.slice();
      cached.imageData = _adminCurrentImages[0] || "";
    }
    renderAdminImagePreviews();
    showToast("Photo removed.", "success");
  } catch (e) {
    console.error(e);
    showToast("Error removing photo. Check your connection.", "error");
  }
}
window.adminRemoveImage = adminRemoveImage;

// Draws the current photos as thumbnails with a ✕ remove button on each,
// inside the Admin Edit Mess page.
function renderAdminImagePreviews() {
  const grid = document.getElementById("amf_image_preview_grid");
  if (!grid) return;
  if (_adminCurrentImages.length === 0) {
    grid.innerHTML = `<p style="color:var(--muted);font-size:0.82rem">No photos uploaded for this listing.</p>`;
    return;
  }
  grid.innerHTML = _adminCurrentImages.map((src, i) => `
    <div class="img-thumb-wrap">
      <img src="${src}" class="img-thumb" alt="Photo ${i + 1}">
      ${i === 0 ? '<div class="img-thumb-badge">Cover</div>' : ""}
      <button class="img-thumb-remove" onclick="adminRemoveImage(${i})" title="Remove this photo">✕</button>
    </div>
  `).join("");
}

// "Danger Zone" delete button on the Admin Edit Mess page itself — reuses
// the same confirmation popup as the dashboard's delete buttons.
function adminDeleteFromEditPage() {
  const firestoreId = document.getElementById("amf_editId").value.trim();
  const name = document.getElementById("amf_name").value.trim() || "this mess";
  if (!firestoreId) return;
  openDeleteModal(firestoreId, name, true);
}
window.adminDeleteFromEditPage = adminDeleteFromEditPage;

async function adminSaveMess() {
  if (!currentAdmin) return;
  const errEl = document.getElementById("adminMessFormError");
  const saveBtn = document.getElementById("adminSaveBtn");
  errEl.style.display = "none";
  const firestoreId = document.getElementById("amf_editId").value.trim();
  const name = document.getElementById("amf_name").value.trim();
  const address = document.getElementById("amf_address").value.trim();
  const rent = parseInt(document.getElementById("amf_rent").value) || 0;
  const seatsSingleThisMonth = parseInt(document.getElementById("amf_seats_single_this").value) || 0;
  const seatsMultiThisMonth = parseInt(document.getElementById("amf_seats_multi_this").value) || 0;
  const seatsSingleNextMonth = parseInt(document.getElementById("amf_seats_single_next").value) || 0;
  const seatsMultiNextMonth = parseInt(document.getElementById("amf_seats_multi_next").value) || 0;
  const seats = seatsSingleThisMonth + seatsMultiThisMonth;
  if (!firestoreId || !name || !address || rent < 1) {
    showFormError(errEl, "Please fill all required fields.");
    return;
  }
  const original = _allMesses.find(x => x.firestoreId === firestoreId);
  const updatedMess = {
    ...original,
    name: name,
    type: document.getElementById("amf_type").value,
    location: document.getElementById("amf_location").value,
    address: address,
    distance: parseInt(document.getElementById("amf_distance").value) || 0,
    rent: rent,
    buildingType: document.getElementById("amf_buildingtype").value,
    seats: seats,
    seatsSingleThisMonth: seatsSingleThisMonth,
    seatsMultiThisMonth: seatsMultiThisMonth,
    seatsSingleNextMonth: seatsSingleNextMonth,
    seatsMultiNextMonth: seatsMultiNextMonth,
    ppr: parseInt(document.getElementById("amf_ppr").value) || 2,
    elec: parseInt(document.getElementById("amf_elec").value) || 1,
    wifi: document.getElementById("amf_wifi").value === "true",
    gas: document.getElementById("amf_gas").value === "true",
    tiled: document.getElementById("amf_tiled").value === "true",
    meal: document.getElementById("amf_meal").value === "true",
    mealsDay: parseInt(document.getElementById("amf_mealsday").value) || 0,
    single: document.getElementById("amf_single").value === "true",
    singleCost: parseInt(document.getElementById("amf_singlecost").value) || 0,
    mapLink: document.getElementById("amf_maplink").value.trim(),
    desc: document.getElementById("amf_desc").value.trim(),
    // Save whatever photos remain in the admin's photo grid (in case any
    // were removed) rather than blindly carrying over the original list.
    images: _adminCurrentImages.slice(),
    imageData: _adminCurrentImages[0] || "",
    lastEditedByAdmin: true,
    adminEditedAt: serverTimestamp()
  };
  delete updatedMess.firestoreId;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  try {
    await setDoc(doc(db, MESSES_COL, firestoreId), updatedMess);
    showToast("Mess updated by Admin!", "success");
    showPage("adminDashboard");
  } catch (e) {
    console.error(e);
    showToast("Error saving. Check connection.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "🛡️ Save Changes";
  }
}

window.adminSaveMess = adminSaveMess;

async function renderOwnerDashboard() {
  if (!currentOwner) {
    showPage("ownerLogin");
    return;
  }
  document.getElementById("ownerNameDisplay").textContent = currentOwner.name || "";
  document.getElementById("ownerContactDisplay").textContent = currentOwner.contact || "";
  document.getElementById("ownerEmailDisplay").textContent = currentOwner.email || "No email set";
  const editSec = document.getElementById("editProfileSection");
  if (editSec) editSec.style.display = "none";
  const q = query(collection(db, MESSES_COL), where("ownerUid", "==", currentOwner.firestoreId));
  const snap = await getDocs(q);
  const myMesses = snap.docs.map(d => ({
    firestoreId: d.id,
    ...d.data()
  }));
  myMesses.forEach(m => {
    const idx = _allMesses.findIndex(x => x.firestoreId === m.firestoreId);
    if (idx !== -1) _allMesses[idx] = m; else _allMesses.push(m);
  });
  document.getElementById("ownerStats").innerHTML = `\n    <div class="stat-card"><div class="num">${myMesses.length}</div><div class="lbl">My Listings</div></div>\n    <div class="stat-card"><div class="num">${myMesses.reduce((a, m) => a + m.seats, 0)}</div><div class="lbl">Total Seats</div></div>\n    <div class="stat-card"><div class="num">${myMesses.filter(m => m.type === "BOYS").length}</div><div class="lbl">Boys Messes</div></div>\n    <div class="stat-card"><div class="num">${myMesses.filter(m => m.type === "GIRLS").length}</div><div class="lbl">Girls Messes</div></div>\n  `;
  renderMesses(myMesses, "ownerMessGrid", true);
}

function switchOwnerTab(tabName, btn, skipClear = false) {
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-myListings").style.display = tabName === "myListings" ? "" : "none";
  document.getElementById("tab-addMess").style.display = tabName === "addMess" ? "" : "none";
  if (tabName === "addMess" && !skipClear) {
    clearMessForm();
    document.getElementById("messFormTitle").textContent = "Add New Mess / Sublet";
  }
}

window.switchOwnerTab = switchOwnerTab;

function toggleEditProfile() {
  const sec = document.getElementById("editProfileSection");
  const isHidden = sec.style.display === "none";
  sec.style.display = isHidden ? "block" : "none";
  if (isHidden) loadProfileForm();
}

window.toggleEditProfile = toggleEditProfile;

function loadProfileForm() {
  if (!currentOwner) return;
  document.getElementById("profile_name").value = currentOwner.name || "";
  document.getElementById("profile_contact").value = currentOwner.contact || "";
  document.getElementById("profile_email").value = currentOwner.email || "";
  document.getElementById("profileError").style.display = "none";
  document.getElementById("profileSuccess").style.display = "none";
}

async function saveProfile() {
  if (!currentOwner) return;
  const name = document.getElementById("profile_name").value.trim();
  const contact = document.getElementById("profile_contact").value.trim();
  const email = document.getElementById("profile_email").value.trim();
  const errEl = document.getElementById("profileError");
  const sucEl = document.getElementById("profileSuccess");
  errEl.style.display = "none";
  sucEl.style.display = "none";
  if (!name || !contact || !email) {
    showFormError(errEl, "Please fill all fields.");
    return;
  }
  if (!isValidEmail(email)) {
    showFormError(errEl, "That doesn't look like a valid email address. Please enter a valid one, e.g. yourname@example.com.");
    return;
  }
  try {
    await setDoc(doc(db, OWNERS_COL, currentOwner.firestoreId), {
      name: name,
      contact: contact,
      email: email,
      updatedAt: serverTimestamp()
    }, { merge: true });
    currentOwner = {
      ...currentOwner,
      name: name,
      contact: contact,
      email: email
    };
    document.getElementById("ownerNameDisplay").textContent = name;
    document.getElementById("ownerContactDisplay").textContent = contact;
    document.getElementById("ownerEmailDisplay").textContent = email;
    sucEl.textContent = "✓ Profile updated successfully!";
    sucEl.style.display = "block";
    showToast("Profile updated!", "success");
    setTimeout(() => {
      document.getElementById("editProfileSection").style.display = "none";
    }, 1200);
  } catch (e) {
    console.error(e);
    showFormError(errEl, "Error updating profile. Check your connection.");
  }
}

window.saveProfile = saveProfile;

async function saveMess() {
  if (!currentOwner || !auth.currentUser || auth.currentUser.uid !== currentOwner.firestoreId) return;
  const errEl = document.getElementById("messFormError");
  const saveBtn = document.getElementById("saveBtn");
  errEl.style.display = "none";
  const name = document.getElementById("mf_name").value.trim();
  const address = document.getElementById("mf_address").value.trim();
  const rent = parseInt(document.getElementById("mf_rent").value) || 0;
  const seatsSingleThisMonth = parseInt(document.getElementById("mf_seats_single_this").value) || 0;
  const seatsMultiThisMonth = parseInt(document.getElementById("mf_seats_multi_this").value) || 0;
  const seatsSingleNextMonth = parseInt(document.getElementById("mf_seats_single_next").value) || 0;
  const seatsMultiNextMonth = parseInt(document.getElementById("mf_seats_multi_next").value) || 0;
  const seats = seatsSingleThisMonth + seatsMultiThisMonth;
  if (!name || !address || rent < 1) {
    showFormError(errEl, "Please fill all required fields (Name, Address, Rent > 0, Seats).");
    return;
  }
  const editIdVal = document.getElementById("mf_editId").value.trim();
  const editId = editIdVal ? editIdVal : null;
  const mess = {
    ownerUid: auth.currentUser.uid,
    ownerId: auth.currentUser.uid,
    ownerName: currentOwner.name,
    name: name,
    type: document.getElementById("mf_type").value,
    location: document.getElementById("mf_location").value,
    address: address,
    distance: parseInt(document.getElementById("mf_distance").value) || 0,
    rent: rent,
    buildingType: document.getElementById("mf_buildingtype").value,
    seats: seats,
    seatsSingleThisMonth: seatsSingleThisMonth,
    seatsMultiThisMonth: seatsMultiThisMonth,
    seatsSingleNextMonth: seatsSingleNextMonth,
    seatsMultiNextMonth: seatsMultiNextMonth,
    ppr: parseInt(document.getElementById("mf_ppr").value) || 2,
    elec: parseInt(document.getElementById("mf_elec").value) || 1,
    wifi: document.getElementById("mf_wifi").value === "true",
    gas: document.getElementById("mf_gas").value === "true",
    tiled: document.getElementById("mf_tiled").value === "true",
    meal: document.getElementById("mf_meal").value === "true",
    mealsDay: parseInt(document.getElementById("mf_mealsday").value) || 0,
    single: document.getElementById("mf_single").value === "true",
    singleCost: parseInt(document.getElementById("mf_singlecost").value) || 0,
    mapLink: document.getElementById("mf_maplink").value.trim(),
    contact: currentOwner.contact,
    desc: document.getElementById("mf_desc").value.trim(),
    images: _currentImages.slice(),
    imageData: _currentImages[0] || ""
  };
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  try {
    if (editId) {
      // FIX: don't overwrite the original createdAt when editing — that
      // was silently bumping every edited mess to the top of the "newest
      // first" browse list and losing its real creation date. Only stamp
      // an updatedAt instead, and merge so unrelated fields aren't wiped.
      await setDoc(doc(db, MESSES_COL, editId), { ...mess, updatedAt: serverTimestamp() }, { merge: true });
      showToast("Mess updated successfully!", "success");
    } else {
      await addDoc(collection(db, MESSES_COL), { ...mess, createdAt: serverTimestamp() });
      showToast("Mess added successfully!", "success");
    }
    clearMessForm();
    await renderOwnerDashboard();
    switchOwnerTab("myListings", document.querySelectorAll(".nav-tab")[0]);
  } catch (e) {
    console.error(e);
    showToast("Error saving mess. Check your connection.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Listing";
  }
}

window.saveMess = saveMess;

function editMess(firestoreId) {
  const m = _allMesses.find(x => x.firestoreId === firestoreId);
  if (!m) {
    showToast("Could not find listing.", "error");
    return;
  }
  document.getElementById("mf_editId").value = m.firestoreId;
  document.getElementById("mf_name").value = m.name;
  document.getElementById("mf_type").value = m.type;
  document.getElementById("mf_location").value = m.location;
  document.getElementById("mf_address").value = m.address;
  document.getElementById("mf_distance").value = m.distance;
  document.getElementById("mf_rent").value = m.rent;
  document.getElementById("mf_buildingtype").value = m.buildingType || "BUILDING";
  document.getElementById("mf_seats_single_this").value = m.seatsSingleThisMonth || 0;
  document.getElementById("mf_seats_multi_this").value = m.seatsMultiThisMonth != null ? m.seatsMultiThisMonth : m.seats || 0;
  document.getElementById("mf_seats_single_next").value = m.seatsSingleNextMonth || 0;
  document.getElementById("mf_seats_multi_next").value = m.seatsMultiNextMonth || 0;
  document.getElementById("mf_ppr").value = m.ppr;
  document.getElementById("mf_elec").value = m.elec;
  document.getElementById("mf_wifi").value = String(m.wifi);
  document.getElementById("mf_gas").value = String(m.gas);
  document.getElementById("mf_tiled").value = String(m.tiled);
  document.getElementById("mf_meal").value = String(m.meal);
  document.getElementById("mf_mealsday").value = m.mealsDay;
  document.getElementById("mf_single").value = String(m.single);
  document.getElementById("mf_singlecost").value = m.singleCost;
  document.getElementById("mf_maplink").value = m.mapLink || "";
  document.getElementById("mf_desc").value = m.desc || "";
  _currentImages = m.images && m.images.length > 0 ? m.images.slice() : m.imageData ? [ m.imageData ] : [];
  renderImagePreviews();
  document.getElementById("mf_image_data").value = JSON.stringify(_currentImages);
  document.getElementById("messFormTitle").textContent = "Edit: " + m.name;
  toggleMealInput();
  toggleSingleInput();
  switchOwnerTab("addMess", document.querySelectorAll(".nav-tab")[1], true);
  document.getElementById("tab-addMess").scrollIntoView({
    behavior: "smooth"
  });
}

window.editMess = editMess;

function cancelEdit() {
  clearMessForm();
  switchOwnerTab("myListings", document.querySelectorAll(".nav-tab")[0]);
}

window.cancelEdit = cancelEdit;

function clearMessForm() {
  [ "mf_name", "mf_address", "mf_distance", "mf_rent", "mf_desc", "mf_editId", "mf_maplink" ].forEach(id => document.getElementById(id).value = "");
  [ "mf_seats_single_this", "mf_seats_multi_this", "mf_seats_single_next", "mf_seats_multi_next" ].forEach(id => document.getElementById(id).value = "0");
  document.getElementById("mf_ppr").value = "2";
  document.getElementById("mf_elec").value = "1";
  document.getElementById("mf_mealsday").value = "2";
  document.getElementById("mf_singlecost").value = "0";
  document.getElementById("mf_image_data").value = "";
  _currentImages = [];
  renderImagePreviews();
  [ "mf_type", "mf_location", "mf_wifi", "mf_gas", "mf_tiled", "mf_meal", "mf_single", "mf_buildingtype" ].forEach(id => document.getElementById(id).selectedIndex = 0);
  document.getElementById("messFormError").style.display = "none";
  toggleMealInput();
  toggleSingleInput();
}

function openDeleteModal(firestoreId, name, isAdmin = false) {
  pendingDeleteId = firestoreId;
  pendingDeleteType = isAdmin ? "admin" : "owner";
  document.getElementById("deleteMessName").textContent = name;
  document.getElementById("deleteModalNote").textContent = isAdmin ? "⚠️ Admin delete — This cannot be undone." : "This action cannot be undone.";
  document.getElementById("deleteModal").classList.add("open");
}

window.openDeleteModal = openDeleteModal;

async function confirmDelete() {
  if (!pendingDeleteId) return;
  try {
    await deleteDoc(doc(db, MESSES_COL, pendingDeleteId));
    _allMesses = _allMesses.filter(m => m.firestoreId !== pendingDeleteId);
    closeDeleteModal();
    showToast("Listing deleted.", "success");
    pendingDeleteId = null;
    if (pendingDeleteType === "admin") {
      await renderAdminDashboard();
    } else {
      await renderOwnerDashboard();
    }
    pendingDeleteType = null;
  } catch (e) {
    console.error(e);
    showToast("Error deleting listing.", "error");
  }
}

window.confirmDelete = confirmDelete;

function closeDeleteModal(e) {
  if (e && e.target !== document.getElementById("deleteModal")) return;
  document.getElementById("deleteModal").classList.remove("open");
}

window.closeDeleteModal = closeDeleteModal;

function openOwnerDeleteModal(firestoreId, name) {
  pendingOwnerDeleteId = firestoreId;
  document.getElementById("deleteOwnerName").textContent = name;
  document.getElementById("ownerDeleteModal").classList.add("open");
}

window.openOwnerDeleteModal = openOwnerDeleteModal;

async function confirmOwnerDelete() {
  if (!pendingOwnerDeleteId) return;
  try {
    const ownerMesses = _allMesses.filter(m => m.ownerId === pendingOwnerDeleteId);
    for (const m of ownerMesses) {
      await deleteDoc(doc(db, MESSES_COL, m.firestoreId));
    }
    await deleteDoc(doc(db, OWNERS_COL, pendingOwnerDeleteId));
    closeOwnerDeleteModal();
    showToast("Owner and all their listings removed.", "success");
    pendingOwnerDeleteId = null;
    await renderAdminDashboard();
  } catch (e) {
    console.error(e);
    showToast("Error removing owner.", "error");
  }
}

window.confirmOwnerDelete = confirmOwnerDelete;

function closeOwnerDeleteModal(e) {
  if (e && e.target !== document.getElementById("ownerDeleteModal")) return;
  document.getElementById("ownerDeleteModal").classList.remove("open");
}

window.closeOwnerDeleteModal = closeOwnerDeleteModal;

async function sendBroadcastEmail() {
  if (!currentAdmin) return;
  const subject = document.getElementById("broadcast_subject").value.trim();
  const message = document.getElementById("broadcast_message").value.trim();
  const errEl = document.getElementById("broadcastError");
  const sucEl = document.getElementById("broadcastSuccess");
  const btn = document.getElementById("broadcastBtn");
  errEl.style.display = "none";
  sucEl.style.display = "none";
  if (!subject || !message) {
    showFormError(errEl, "Please fill in subject and message.");
    return;
  }
  const ownersWithEmail = _allOwners.filter(o => o.email);
  if (ownersWithEmail.length === 0) {
    showFormError(errEl, "No owners have registered an email address yet.");
    return;
  }
  btn.disabled = true;
  btn.textContent = `Sending... (0/${ownersWithEmail.length})`;
  let sent = 0, failed = 0;
  emailjs.init(EJS_PUBLIC_KEY);
  try {
    for (const owner of ownersWithEmail) {
      try {
        await emailjs.send(EJS_SERVICE_ID, EJS_TEMPLATE_ID, {
          to_email: owner.email,
          to_name: owner.name,
          subject: subject,
          message: message
        });
        sent++;
      } catch (e) {
        console.error("Failed to send to", owner.email, e);
        failed++;
      }
      btn.textContent = `Sending... (${sent + failed}/${ownersWithEmail.length})`;
    }
  } catch (e) {
    console.error("Broadcast email failed", e);
    failed = ownersWithEmail.length - sent;
    showFormError(errEl, "Email sending failed. Check your EmailJS configuration.");
  }
  btn.disabled = false;
  btn.textContent = "📧 Send to All Owners";
  if (failed === 0) {
    sucEl.textContent = `✓ Email sent successfully to ${sent} owners!`;
    sucEl.style.display = "block";
    document.getElementById("broadcast_subject").value = "";
    document.getElementById("broadcast_message").value = "";
    showToast(`Email sent to ${sent} owners!`, "success");
  } else {
    sucEl.textContent = `Sent: ${sent} ✓   Failed: ${failed} ✗`;
    sucEl.style.display = "block";
  }
}

window.sendBroadcastEmail = sendBroadcastEmail;

async function sendSingleEmail(toEmail, toName) {
  if (!currentAdmin) return;
  const subject = prompt(`Email subject for ${toName}:`, "Please update your mess information");
  if (!subject) return;
  const message = prompt(`Message for ${toName}:`);
  if (!message) return;
  try {
    emailjs.init(EJS_PUBLIC_KEY);
    await emailjs.send(EJS_SERVICE_ID, EJS_TEMPLATE_ID, {
      to_email: toEmail,
      to_name: toName,
      subject: subject,
      message: message
    });
    showToast(`Email sent to ${toName}!`, "success");
  } catch (e) {
    console.error(e);
    showToast("Failed to send email. Check your EmailJS configuration.", "error");
  }
}

window.sendSingleEmail = sendSingleEmail;

function previewImages(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  const remaining = 6 - _currentImages.length;
  if (remaining <= 0) {
    showToast("Maximum 6 photos allowed.", "error");
    return;
  }
  files.slice(0, remaining).forEach(file => {
    const reader = new FileReader;
    reader.onload = function(e) {
      compressImage(e.target.result, 800, .6, function(compressed) {
        _currentImages.push(compressed);
        renderImagePreviews();
        document.getElementById("mf_image_data").value = JSON.stringify(_currentImages);
      });
    };
    reader.readAsDataURL(file);
  });
  event.target.value = "";
}

window.previewImages = previewImages;

function compressImage(dataUrl, maxWidth, quality, callback) {
  const img = new Image;
  img.onload = function() {
    const canvas = document.createElement("canvas");
    let w = img.width, h = img.height;
    if (w > maxWidth) {
      h = Math.round(h * maxWidth / w);
      w = maxWidth;
    }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL("image/jpeg", quality));
  };
  img.src = dataUrl;
}

function renderImagePreviews() {
  const grid = document.getElementById("mf_image_preview_grid");
  if (!grid) return;
  grid.innerHTML = _currentImages.map((src, i) => `\n    <div class="img-thumb-wrap">\n      <img src="${src}" class="img-thumb" alt="Photo ${i + 1}">\n      ${i === 0 ? '<div class="img-thumb-badge">Cover</div>' : ""}\n      <button class="img-thumb-remove" onclick="removeImage(${i})" title="Remove">✕</button>\n    </div>\n  `).join("");
}

function removeImage(index) {
  _currentImages.splice(index, 1);
  renderImagePreviews();
  document.getElementById("mf_image_data").value = JSON.stringify(_currentImages);
}

window.removeImage = removeImage;

function toggleMealInput() {
  document.getElementById("mealDayGroup").style.display = document.getElementById("mf_meal").value === "true" ? "" : "none";
}

window.toggleMealInput = toggleMealInput;

function toggleSingleInput() {
  const enabled = document.getElementById("mf_single").value === "true";
  document.getElementById("singleCostGroup").style.display = enabled ? "" : "none";
  document.getElementById("singleSeatsThisGroup").style.display = enabled ? "" : "none";
  document.getElementById("singleSeatsNextGroup").style.display = enabled ? "" : "none";
}

window.toggleSingleInput = toggleSingleInput;

function toggleAdminMealInput() {
  document.getElementById("adminMealDayGroup").style.display = document.getElementById("amf_meal").value === "true" ? "" : "none";
}

window.toggleAdminMealInput = toggleAdminMealInput;

function toggleAdminSingleInput() {
  const enabled = document.getElementById("amf_single").value === "true";
  document.getElementById("adminSingleCostGroup").style.display = enabled ? "" : "none";
  document.getElementById("adminSingleSeatsThisGroup").style.display = enabled ? "" : "none";
  document.getElementById("adminSingleSeatsNextGroup").style.display = enabled ? "" : "none";
}

window.toggleAdminSingleInput = toggleAdminSingleInput;

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  const showIcon = btn.querySelector(".eye-show");
  const hideIcon = btn.querySelector(".eye-hide");
  if (showIcon) showIcon.style.display = isHidden ? "none" : "block";
  if (hideIcon) hideIcon.style.display = isHidden ? "block" : "none";
}

window.togglePasswordVisibility = togglePasswordVisibility;

function showFormError(el, msg) {
  el.textContent = msg;
  el.style.display = "block";
}

function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("mbstu_theme", isLight ? "light" : "dark");
  updateThemeKnob(isLight);
}

window.toggleTheme = toggleTheme;

function updateThemeKnob(isLight) {
  const knob = document.getElementById("themeKnob");
  if (knob) knob.textContent = isLight ? "☀️" : "🌙";
}

function initTheme() {
  const saved = localStorage.getItem("mbstu_theme");
  const isLight = saved === "light";
  if (isLight) document.body.classList.add("light");
  updateThemeKnob(isLight);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.textContent = (type === "success" ? "✓ " : "✕ ") + msg;
  t.className = "toast show " + type;
  setTimeout(() => t.classList.remove("show"), 3e3);
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    [ "detailModal", "reviewsModal", "deleteModal", "ownerDeleteModal" ].forEach(id => {
      document.getElementById(id).classList.remove("open");
    });
    document.body.style.overflow = "";
  }
  if (e.key === "Enter") {
    if (document.getElementById("page-ownerLogin").classList.contains("active")) loginOwner();
    if (document.getElementById("page-adminLogin").classList.contains("active")) loginAdmin();
    if (document.getElementById("page-visitorLogin").classList.contains("active")) loginVisitor();
    if (document.getElementById("page-ownerForgot").classList.contains("active")) recoverOwnerAccount();
    if (document.getElementById("page-visitorForgot").classList.contains("active")) recoverVisitorAccount();
  }
});

let _adminAuthResolved = false;

let _resolveAdminAuthReady;

const adminAuthReady = new Promise(resolve => {
  _resolveAdminAuthReady = resolve;
});

onAuthStateChanged(auth, async user => {
  currentAdmin = await hasAdminClaim(user);
  currentOwner = null;
  currentVisitor = null;
  if (user && !currentAdmin) {
    try {
      const ownerSnap = await getDoc(doc(db, OWNERS_COL, user.uid));
      if (ownerSnap.exists()) {
        currentOwner = {
          firestoreId: user.uid,
          ...ownerSnap.data()
        };
      } else if (user.emailVerified) {
        const visitorSnap = await getDoc(doc(db, VISITORS_COL, user.uid));
        if (visitorSnap.exists()) {
          currentVisitor = {
            firestoreId: user.uid,
            ...visitorSnap.data()
          };
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
  updateHeader();
  if (!currentAdmin && document.getElementById("page-adminDashboard").classList.contains("active")) {
    showPage("adminLogin");
  }
  if (!_adminAuthResolved) {
    _adminAuthResolved = true;
    _resolveAdminAuthReady();
  }
});

(async () => {
  initTheme();
  await adminAuthReady;
  updateHeader();
  await loadAndRenderMesses();
  const hash = window.location.hash.replace("#", "");
  const valid = [ "browse", "ownerLogin", "ownerRegister", "ownerForgot", "visitorLogin", "visitorForgot", "visitorRegister", "ownerDashboard", "adminLogin", "adminDashboard" ];
  if (hash && valid.includes(hash)) {
    if (hash === "ownerDashboard" && !currentOwner) showPage("ownerLogin", false); else if (hash === "adminDashboard" && !currentAdmin) showPage("adminLogin", false); else showPage(hash, false);
  } else {
    showPage("browse", false);
    history.replaceState({
      page: "browse"
    }, "", "#browse");
  }
  hideLoading();
})();