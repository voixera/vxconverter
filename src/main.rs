use std::net::SocketAddr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use vx_converter::{create_router, AppConfig, AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,vx_converter=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = AppConfig::from_env();
    let port = config.port;

    tracing::info!("Initializing VX Converter Engine...");
    let state = AppState::new(config).await;
    let router = create_router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("VX Converter listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;

    Ok(())
}
