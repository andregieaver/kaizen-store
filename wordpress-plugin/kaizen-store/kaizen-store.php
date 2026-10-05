<?php
/**
 * Plugin Name:       Kaizen Store
 * Plugin URI:        https://kaizenstore.cloud
 * Description:       Show products from your Kaizen Store stores on your WordPress site, as a grid or a carousel, with shortcodes you generate once and reuse anywhere.
 * Version:           1.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Kaizen Store
 * Author URI:        https://kaizenstore.cloud
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       kaizen-store
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'KAIZEN_STORE_VERSION', '1.1.0' );
define( 'KAIZEN_STORE_FILE', __FILE__ );
define( 'KAIZEN_STORE_DIR', plugin_dir_path( __FILE__ ) );
define( 'KAIZEN_STORE_URL', plugin_dir_url( __FILE__ ) );

require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-settings.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-api.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-connect.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-views.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-render.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-product.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-rest.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-shortcode.php';
require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-admin.php';

/**
 * Starts the plugin: the saved views, the shortcode, and (in the admin) the connection and the editor.
 */
function kaizen_store_boot() {
	Kaizen_Store_Views::init();
	Kaizen_Store_Product::init();
	Kaizen_Store_Rest::init();
	Kaizen_Store_Shortcode::init();
	if ( is_admin() ) {
		Kaizen_Store_Connect::init();
		Kaizen_Store_Admin::init();
	}
}
add_action( 'plugins_loaded', 'kaizen_store_boot' );

/**
 * When the plugin is replaced by a newer version (an upload does not run the activation hook): the product page is made and the rules refreshed once.
 */
function kaizen_store_upgrade() {
	if ( KAIZEN_STORE_VERSION !== get_option( 'kaizen_store_version' ) ) {
		Kaizen_Store_Product::create_page();
		Kaizen_Store_Product::schedule_flush();
		update_option( 'kaizen_store_version', KAIZEN_STORE_VERSION, false );
	}
}
add_action( 'init', 'kaizen_store_upgrade', 5 );

/**
 * On activation: the product page (a page with the shortcode) is made once, and its address is added to the rewrite rules.
 */
function kaizen_store_activate() {
	require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-settings.php';
	require_once KAIZEN_STORE_DIR . 'includes/class-kaizen-store-product.php';
	Kaizen_Store_Product::create_page();
}
register_activation_hook( __FILE__, 'kaizen_store_activate' );
