<?php
/**
 * What the plugin keeps about the connection to Kaizen: the address of Kaizen, the token, and who connected.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Settings {

	const OPTION     = 'kaizen_store_connection';
	const DEFAULT_URL = 'https://kaizenstore.cloud';

	/**
	 * The connection: array( 'api_url', 'token', 'email', 'connected_at' ), or an empty array.
	 *
	 * @return array
	 */
	public static function connection() {
		$value = get_option( self::OPTION, array() );
		return is_array( $value ) ? $value : array();
	}

	/**
	 * Keeps a connection. Never loaded on every page (autoload is off): only the shortcode and the admin read it.
	 *
	 * @param string $token Token from Kaizen.
	 * @param string $email Who approved it.
	 */
	public static function save_connection( $token, $email ) {
		$value = array(
			'api_url'      => self::api_url(),
			'token'        => (string) $token,
			'email'        => (string) $email,
			'connected_at' => time(),
		);
		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, $value, '', 'no' );
		} else {
			update_option( self::OPTION, $value, false );
		}
	}

	public static function clear_connection() {
		delete_option( self::OPTION );
		Kaizen_Store_Render::clear_cache();
	}

	public static function is_connected() {
		$connection = self::connection();
		return ! empty( $connection['token'] );
	}

	public static function token() {
		$connection = self::connection();
		return isset( $connection['token'] ) ? (string) $connection['token'] : '';
	}

	/**
	 * The address of Kaizen, without a trailing slash. The constant KAIZEN_STORE_API_URL (wp-config.php) wins, then
	 * the address the connection was made to, then the setting, then the default.
	 *
	 * @return string
	 */
	public static function api_url() {
		if ( defined( 'KAIZEN_STORE_API_URL' ) && KAIZEN_STORE_API_URL ) {
			return self::clean_url( KAIZEN_STORE_API_URL );
		}
		$connection = self::connection();
		if ( ! empty( $connection['api_url'] ) ) {
			return self::clean_url( $connection['api_url'] );
		}
		$custom = get_option( 'kaizen_store_api_url', '' );
		return self::clean_url( $custom ? $custom : self::DEFAULT_URL );
	}

	/**
	 * An https address (http only for a developer's own machine), as its origin with no path.
	 *
	 * @param string $url Address.
	 * @return string The origin, or the default address.
	 */
	public static function clean_url( $url ) {
		$parts = wp_parse_url( trim( (string) $url ) );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return self::DEFAULT_URL;
		}
		$local = (bool) preg_match( '/^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|local|test)$/i', $parts['host'] );
		if ( 'https' !== $parts['scheme'] && ! ( 'http' === $parts['scheme'] && $local ) ) {
			return self::DEFAULT_URL;
		}
		$port = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
		return $parts['scheme'] . '://' . $parts['host'] . $port;
	}

	/**
	 * Whether the product pages and the slide-out cart are on (they are, once connected, unless switched off).
	 *
	 * @return bool
	 */
	public static function shop_enabled() {
		return '0' !== (string) get_option( 'kaizen_store_shop', '1' );
	}

	/**
	 * Whether a round cart button is shown on every page (not only where a view is).
	 *
	 * @return bool
	 */
	public static function floating_cart() {
		return '0' !== (string) get_option( 'kaizen_store_floating_cart', '1' );
	}

	/**
	 * This site's origin as Kaizen will check it against the return address: the admin's own.
	 *
	 * @return string
	 */
	public static function site_origin() {
		$parts = wp_parse_url( admin_url() );
		$port  = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
		return $parts['scheme'] . '://' . $parts['host'] . $port;
	}
}
