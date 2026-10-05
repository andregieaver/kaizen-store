<?php
/**
 * Connecting to Kaizen: the owner is sent to Kaizen to approve this site, and comes back with a one-time code that is swapped, server
 * to server, for a token. The password never reaches WordPress; the token reads the stores' public products and nothing else.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Connect {

	const PAGE = 'kaizen-store';

	public static function init() {
		add_action( 'admin_post_kaizen_store_connect', array( __CLASS__, 'start' ) );
		add_action( 'admin_post_kaizen_store_disconnect', array( __CLASS__, 'disconnect' ) );
		add_action( 'admin_post_kaizen_store_clear_cache', array( __CLASS__, 'clear_cache' ) );
		add_action( 'admin_post_kaizen_store_save_address', array( __CLASS__, 'save_address' ) );
		add_action( 'admin_init', array( __CLASS__, 'finish' ) );
	}

	/**
	 * The page the owner is returned to, and where messages are shown.
	 *
	 * @param array $args Extra query arguments.
	 * @return string
	 */
	public static function page_url( $args = array() ) {
		return add_query_arg( array_merge( array( 'page' => self::PAGE ), $args ), admin_url( 'admin.php' ) );
	}

	private static function base64url( $bytes ) {
		return rtrim( strtr( base64_encode( $bytes ), '+/', '-_' ), '=' );
	}

	/**
	 * Step one: makes the secrets, keeps them for ten minutes, and sends the browser to Kaizen's approval page.
	 */
	public static function start() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_connect' );
		$site = Kaizen_Store_Settings::site_origin();
		if ( 0 !== strpos( $site, 'https://' ) && ! preg_match( '#^http://(localhost|127\.0\.0\.1|\[::1\]|[^/]+\.(localhost|local|test))(:\d+)?$#i', $site ) ) {
			wp_safe_redirect( self::page_url( array( 'kaizen_notice' => 'https' ) ) );
			exit;
		}
		$verifier = self::base64url( random_bytes( 32 ) );
		$state    = self::base64url( random_bytes( 24 ) );
		set_transient(
			'kaizen_store_pending_' . $state,
			array(
				'verifier' => $verifier,
				'user'     => get_current_user_id(),
				'site'     => $site,
			),
			10 * MINUTE_IN_SECONDS
		);
		$url = Kaizen_Store_Settings::api_url() . '/admin/account/wordpress/connect?' . http_build_query(
			array(
				'site'      => $site,
				'name'      => wp_strip_all_tags( get_bloginfo( 'name' ) ),
				'return'    => self::page_url(),
				'state'     => $state,
				'challenge' => self::base64url( hash( 'sha256', $verifier, true ) ),
			),
			'',
			'&',
			PHP_QUERY_RFC3986
		);
		// Kaizen is another site: wp_safe_redirect would refuse it.
		wp_redirect( $url ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
		exit;
	}

	/**
	 * Step two: back from Kaizen with `kaizen_code`, swaps it for the token and keeps it.
	 */
	public static function finish() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- the state below is the proof.
		if ( ! isset( $_GET['page'] ) || self::PAGE !== $_GET['page'] || ! isset( $_GET['kaizen_state'] ) ) {
			return;
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$state   = preg_replace( '/[^A-Za-z0-9_-]/', '', wp_unslash( (string) $_GET['kaizen_state'] ) );
		$pending = get_transient( 'kaizen_store_pending_' . $state );
		delete_transient( 'kaizen_store_pending_' . $state );
		if ( ! is_array( $pending ) || (int) $pending['user'] !== get_current_user_id() ) {
			self::back( 'expired' );
		}
		if ( isset( $_GET['kaizen_error'] ) ) {
			self::back( 'denied' );
		}
		$code = isset( $_GET['kaizen_code'] ) ? preg_replace( '/[^A-Za-z0-9_-]/', '', wp_unslash( (string) $_GET['kaizen_code'] ) ) : '';
		// phpcs:enable
		if ( '' === $code ) {
			self::back( 'expired' );
		}
		$answer = Kaizen_Store_Api::exchange( $code, $pending['verifier'], $pending['site'] );
		if ( is_wp_error( $answer ) || empty( $answer['token'] ) ) {
			self::back( 'failed' );
		}
		$email = isset( $answer['account']['email'] ) ? sanitize_email( $answer['account']['email'] ) : '';
		Kaizen_Store_Settings::save_connection( $answer['token'], $email );
		self::back( 'connected' );
	}

	private static function back( $notice ) {
		wp_safe_redirect( self::page_url( array( 'kaizen_notice' => $notice ) ) );
		exit;
	}

	/**
	 * Disconnects: tells Kaizen to end the token (when it can be reached), and forgets it here either way.
	 */
	public static function disconnect() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_disconnect' );
		Kaizen_Store_Api::disconnect();
		Kaizen_Store_Settings::clear_connection();
		self::back( 'disconnected' );
	}

	public static function clear_cache() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_clear_cache' );
		Kaizen_Store_Render::clear_cache();
		self::back( 'cache' );
	}

	/**
	 * Kaizen's address, for a staging copy or a developer's own machine; only while not connected.
	 */
	public static function save_address() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_save_address' );
		if ( Kaizen_Store_Settings::is_connected() ) {
			self::back( 'address_locked' );
		}
		$url = isset( $_POST['kaizen_api_url'] ) ? esc_url_raw( wp_unslash( (string) $_POST['kaizen_api_url'] ) ) : '';
		if ( '' === $url || Kaizen_Store_Settings::DEFAULT_URL === Kaizen_Store_Settings::clean_url( $url ) ) {
			delete_option( 'kaizen_store_api_url' );
		} else {
			update_option( 'kaizen_store_api_url', Kaizen_Store_Settings::clean_url( $url ), false );
		}
		self::back( 'address' );
	}
}
