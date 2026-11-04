<?php
/**
 * Moving to Kaizena Flow (D446 step 2): read-only routes for what WooCommerce's own key cannot reach. Kaizena Flow sends the owner here with
 * a sealed note; the owner presses Allow; this site makes a secret and posts it, server to server, only to the Kaizena Flow address it is set
 * up with. Each later read from Kaizena Flow is signed with that secret and the time, and is refused more than five minutes off. The routes
 * only read: which plugins the shop runs, the redirect plugins' redirects, the SEO plugins' titles and descriptions of products, and
 * MailPoet's subscribers. Stop reading forgets the secret.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Mover {

	const PAGE      = 'kaizen-store-mover';
	const OPTION    = 'kaizen_store_mover_secret';
	const NAMESPACE = 'kaizena-mover/v1';
	const SKEW      = 300;
	const PAGE_SIZE = 500;

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		if ( is_admin() ) {
			add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
			add_action( 'admin_post_kaizen_store_mover_allow', array( __CLASS__, 'allow' ) );
			add_action( 'admin_post_kaizen_store_mover_stop', array( __CLASS__, 'stop' ) );
		}
	}

	/**
	 * Who may allow it: someone who runs the shop.
	 *
	 * @return bool
	 */
	private static function may() {
		return current_user_can( 'manage_woocommerce' ) || current_user_can( 'manage_options' );
	}

	public static function menu() {
		add_submenu_page( Kaizen_Store_Connect::PAGE, __( 'Move to Kaizena Flow', 'kaizen-store' ), __( 'Move to Kaizena Flow', 'kaizen-store' ), 'manage_options', self::PAGE, array( __CLASS__, 'page' ) );
	}

	/**
	 * The page Kaizena Flow sends the owner to: what will be read, and one button.
	 */
	public static function page() {
		if ( ! self::may() ) {
			return;
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- the note is checked by Kaizena Flow, which signed it.
		$note   = isset( $_GET['note'] ) ? preg_replace( '/[^A-Za-z0-9_.-]/', '', wp_unslash( (string) $_GET['note'] ) ) : '';
		$notice = isset( $_GET['kaizen_notice'] ) ? sanitize_key( wp_unslash( (string) $_GET['kaizen_notice'] ) ) : '';
		// phpcs:enable
		$reading = '' !== (string) get_option( self::OPTION, '' );
		echo '<div class="wrap"><h1>' . esc_html__( 'Move to Kaizena Flow', 'kaizen-store' ) . '</h1>';
		if ( 'failed' === $notice ) {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'Kaizena Flow could not be reached, or the request was too old. Start again from Kaizena Flow.', 'kaizen-store' ) . '</p></div>';
		}
		echo '<p>' . esc_html__( 'Kaizena Flow asks to read your shop so it can move it: which plugins you use, your redirects, your products\' SEO titles and descriptions, and your MailPoet subscribers. It only reads: nothing on this site changes, and your shop keeps selling.', 'kaizen-store' ) . '</p>';
		if ( '' !== $note ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			wp_nonce_field( 'kaizen_store_mover_allow' );
			echo '<input type="hidden" name="action" value="kaizen_store_mover_allow" />';
			echo '<input type="hidden" name="note" value="' . esc_attr( $note ) . '" />';
			submit_button( __( 'Allow Kaizena Flow to read my shop', 'kaizen-store' ) );
			echo '</form>';
		}
		if ( $reading ) {
			echo '<p>' . esc_html__( 'Kaizena Flow can read your shop now.', 'kaizen-store' ) . '</p>';
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			wp_nonce_field( 'kaizen_store_mover_stop' );
			echo '<input type="hidden" name="action" value="kaizen_store_mover_stop" />';
			submit_button( __( 'Stop Kaizena Flow reading', 'kaizen-store' ), 'secondary' );
			echo '</form>';
		}
		echo '</div>';
	}

	/**
	 * Allow: a fresh secret, posted with the note to Kaizena Flow's own address (never one from the page's link), kept only when Kaizena Flow
	 * took it; the owner then goes back to Kaizena Flow.
	 */
	public static function allow() {
		if ( ! self::may() ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_mover_allow' );
		$note   = isset( $_POST['note'] ) ? preg_replace( '/[^A-Za-z0-9_.-]/', '', wp_unslash( (string) $_POST['note'] ) ) : '';
		$secret = bin2hex( random_bytes( 32 ) );
		$api    = Kaizen_Store_Settings::api_url();
		$answer = wp_remote_post(
			$api . '/api/woocommerce/mover',
			array(
				'timeout' => 20,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'note'   => $note,
						'secret' => $secret,
						'site'   => home_url(),
					)
				),
			)
		);
		$body = is_wp_error( $answer ) ? array() : json_decode( (string) wp_remote_retrieve_body( $answer ), true );
		if ( is_wp_error( $answer ) || 200 !== (int) wp_remote_retrieve_response_code( $answer ) || ! is_array( $body ) ) {
			wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'kaizen_notice' => 'failed' ), admin_url( 'admin.php' ) ) );
			exit;
		}
		update_option( self::OPTION, $secret, false );
		$back = isset( $body['back'] ) ? (string) $body['back'] : '';
		// Only back to Kaizena Flow itself.
		if ( 0 !== strpos( $back, $api . '/' ) ) {
			$back = $api . '/admin';
		}
		wp_redirect( $back ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- Kaizena Flow is another site.
		exit;
	}

	public static function stop() {
		if ( ! self::may() ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_mover_stop' );
		delete_option( self::OPTION );
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE ), admin_url( 'admin.php' ) ) );
		exit;
	}

	// ---------------------------------------------------------------------------------------------------------------------------------
	// The signed routes
	// ---------------------------------------------------------------------------------------------------------------------------------

	public static function routes() {
		foreach ( array( 'plugins', 'redirects', 'seo', 'subscribers' ) as $route ) {
			register_rest_route(
				self::NAMESPACE,
				'/' . $route,
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'read_' . $route ),
					'permission_callback' => array( __CLASS__, 'signed' ),
				)
			);
		}
	}

	/**
	 * RFC 3986 encoding of the query's pairs, sorted by name then value: the same as Kaizena Flow's `canonicalQuery()`.
	 *
	 * @param array $query The query's pairs.
	 * @return string
	 */
	public static function canonical_query( $query ) {
		$pairs = array();
		foreach ( $query as $name => $value ) {
			if ( is_array( $value ) ) {
				continue;
			}
			$pairs[] = array( (string) $name, (string) $value );
		}
		usort(
			$pairs,
			function ( $a, $b ) {
				return 0 !== strcmp( $a[0], $b[0] ) ? strcmp( $a[0], $b[0] ) : strcmp( $a[1], $b[1] );
			}
		);
		$parts = array();
		foreach ( $pairs as $pair ) {
			$parts[] = rawurlencode( $pair[0] ) . '=' . rawurlencode( $pair[1] );
		}
		return implode( '&', $parts );
	}

	/**
	 * Whether a call carries a good signature: the secret's HMAC over the time, the method, the route and the query, within five minutes.
	 *
	 * @param string $secret    The secret, or '' when none is kept.
	 * @param string $time      The call's time (seconds).
	 * @param string $signature The call's signature (hex).
	 * @param string $method    The method.
	 * @param string $route     The route (`/kaizena-mover/v1/seo`).
	 * @param array  $query     The query's pairs.
	 * @param int    $now       This site's time.
	 * @return bool
	 */
	public static function verify( $secret, $time, $signature, $method, $route, $query, $now ) {
		if ( '' === $secret || ! preg_match( '/^\d{1,12}$/', (string) $time ) || ! preg_match( '/^[a-f0-9]{64}$/', (string) $signature ) ) {
			return false;
		}
		if ( abs( (int) $now - (int) $time ) > self::SKEW ) {
			return false;
		}
		$expected = hash_hmac( 'sha256', $time . "\n" . strtoupper( $method ) . "\n" . $route . "\n" . self::canonical_query( $query ), $secret );
		return hash_equals( $expected, (string) $signature );
	}

	/**
	 * The routes' permission: only a call signed with the kept secret.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return bool
	 */
	public static function signed( $request ) {
		$query = $request->get_query_params();
		unset( $query['rest_route'] );
		return self::verify( (string) get_option( self::OPTION, '' ), (string) $request->get_header( 'x_kaizena_mover_time' ), (string) $request->get_header( 'x_kaizena_mover_signature' ), $request->get_method(), $request->get_route(), $query, time() );
	}

	/**
	 * The page asked for (from 1), as an offset.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return int
	 */
	private static function offset( $request ) {
		return max( 0, (int) $request->get_param( 'page' ) - 1 ) * self::PAGE_SIZE;
	}

	private static function table_exists( $table ) {
		global $wpdb;
		return $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * The plugins the shop runs: each one's folder and name, nothing else.
	 */
	public static function read_plugins() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$all    = get_plugins();
		$active = (array) get_option( 'active_plugins', array() );
		$out    = array();
		foreach ( $active as $file ) {
			$slug  = strtok( (string) $file, '/' );
			$out[] = array(
				'slug' => $slug,
				'name' => isset( $all[ $file ]['Name'] ) ? wp_strip_all_tags( $all[ $file ]['Name'] ) : $slug,
			);
		}
		return rest_ensure_response( array( 'plugins' => $out ) );
	}

	/**
	 * The redirects of Redirection, Rank Math and Yoast SEO Premium, a page at a time: from, to, and whether it is a pattern.
	 *
	 * @param WP_REST_Request $request The request.
	 */
	public static function read_redirects( $request ) {
		global $wpdb;
		$all = array();
		$redirection = $wpdb->prefix . 'redirection_items';
		if ( self::table_exists( $redirection ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table's name is this site's prefix.
			$rows = $wpdb->get_results( "SELECT url, action_data, regex FROM {$redirection} WHERE status = 'enabled' AND action_type = 'url' AND match_type = 'url' ORDER BY id", ARRAY_A );
			foreach ( (array) $rows as $row ) {
				$all[] = array( 'source' => 'redirection', 'from' => (string) $row['url'], 'to' => (string) $row['action_data'], 'regex' => '1' === (string) $row['regex'] );
			}
		}
		$rank_math = $wpdb->prefix . 'rank_math_redirections';
		if ( self::table_exists( $rank_math ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table's name is this site's prefix.
			$rows = $wpdb->get_results( "SELECT sources, url_to FROM {$rank_math} WHERE status = 'active' ORDER BY id", ARRAY_A );
			foreach ( (array) $rows as $row ) {
				$sources = maybe_unserialize( $row['sources'] );
				foreach ( is_array( $sources ) ? $sources : array() as $source ) {
					if ( is_array( $source ) && isset( $source['pattern'] ) ) {
						$exact = isset( $source['comparison'] ) && 'exact' === $source['comparison'];
						$all[] = array( 'source' => 'rank-math', 'from' => '/' . ltrim( (string) $source['pattern'], '/' ), 'to' => (string) $row['url_to'], 'regex' => ! $exact );
					}
				}
			}
		}
		$yoast = get_option( 'wpseo-premium-redirects-base', array() );
		foreach ( is_array( $yoast ) ? $yoast : array() as $redirect ) {
			if ( is_array( $redirect ) && isset( $redirect['origin'], $redirect['url'] ) ) {
				$all[] = array( 'source' => 'yoast', 'from' => '/' . ltrim( (string) $redirect['origin'], '/' ), 'to' => (string) $redirect['url'], 'regex' => isset( $redirect['format'] ) && 'regex' === $redirect['format'] );
			}
		}
		$offset = self::offset( $request );
		return rest_ensure_response(
			array(
				'redirects' => array_slice( $all, $offset, self::PAGE_SIZE ),
				'more'      => count( $all ) > $offset + self::PAGE_SIZE,
			)
		);
	}

	/**
	 * The SEO plugin's own title and description of the products asked for (`ids`, at most 100), Yoast's or Rank Math's.
	 *
	 * @param WP_REST_Request $request The request.
	 */
	public static function read_seo( $request ) {
		$ids = array_slice( array_filter( array_map( 'intval', explode( ',', (string) $request->get_param( 'ids' ) ) ) ), 0, 100 );
		$out = array();
		foreach ( $ids as $id ) {
			if ( 'product' !== get_post_type( $id ) ) {
				continue;
			}
			$title       = (string) get_post_meta( $id, '_yoast_wpseo_title', true );
			$description = (string) get_post_meta( $id, '_yoast_wpseo_metadesc', true );
			if ( '' === $title ) {
				$title = (string) get_post_meta( $id, 'rank_math_title', true );
			}
			if ( '' === $description ) {
				$description = (string) get_post_meta( $id, 'rank_math_description', true );
			}
			if ( '' !== $title || '' !== $description ) {
				$out[] = array( 'id' => $id, 'title' => wp_strip_all_tags( $title ), 'description' => wp_strip_all_tags( $description ) );
			}
		}
		return rest_ensure_response( array( 'seo' => $out ) );
	}

	/**
	 * MailPoet's subscribed subscribers, a page at a time: the address, the name, and when they subscribed and confirmed. Nobody else.
	 *
	 * @param WP_REST_Request $request The request.
	 */
	public static function read_subscribers( $request ) {
		global $wpdb;
		$table = $wpdb->prefix . 'mailpoet_subscribers';
		if ( ! self::table_exists( $table ) ) {
			return rest_ensure_response( array( 'subscribers' => array(), 'more' => false ) );
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table's name is this site's prefix.
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT email, first_name, last_name, status, last_subscribed_at AS subscribed_at, created_at, confirmed_at FROM {$table} WHERE status = 'subscribed' AND deleted_at IS NULL ORDER BY id LIMIT %d OFFSET %d", self::PAGE_SIZE + 1, self::offset( $request ) ), ARRAY_A );
		$rows = (array) $rows;
		return rest_ensure_response(
			array(
				'subscribers' => array_slice( $rows, 0, self::PAGE_SIZE ),
				'more'        => count( $rows ) > self::PAGE_SIZE,
			)
		);
	}
}
