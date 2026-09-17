pub mod core;
pub mod db;
pub mod extractors;
pub mod guard;
pub mod http;
pub mod routes;
pub mod vx;

pub use core::config::AppConfig;
pub use core::error::VxError;
pub use core::state::AppState;
pub use routes::create_router;

pub fn info() -> &'static str {
    "VX Converter Engine"
}
