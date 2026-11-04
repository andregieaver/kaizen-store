<?php
/**
 * Moving to Kaizena Flow (D446 step 2): read-only routes for what WooCommerce's own key cannot reach. Kaizena Flow sends the owner here with
 * a sealed note; the owner presses Allow; this site makes a secret and posts it, server to server, only to the Kaizena Flow address it is set
 * up with. Each later read from Kaizena Flow is signed with that secret and the time, and is refused more than five minutes off. The routes
 * only read: which plugins the shop runs, the redirect plugins' redirects, every Yoast and Rank Math field of products and categories,
 * MailPoet's subscribers, and the gift card plugins' cards with money left (never a card's code, only its last four characters). Stop reading forgets the secret.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Mover {

	const PAGE      = 'kaizen-store-mover';
	const OPTION    = 'kaizen_store_mover_secret';
	/** The new shop's address, as Kaizena Flow gave it when the owner allowed reading. */
	const SHOP      = 'kaizen_store_mover_shop';
	/** The owner's two switches for the move (D446 step 4): buying paused, and shoppers sent to the new shop. */
	const PAUSED    = 'kaizen_store_mover_paused';
	const MOVED     = 'kaizen_store_mover_moved';
	const NAMESPACE = 'kaizena-mover/v1';
	const SKEW      = 300;
	const PAGE_SIZE = 500;

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		if ( is_admin() ) {
			add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
			add_action( 'admin_post_kaizen_store_mover_allow', array( __CLASS__, 'allow' ) );
			add_action( 'admin_post_kaizen_store_mover_stop', array( __CLASS__, 'stop' ) );
			add_action( 'admin_post_kaizen_store_mover_switch', array( __CLASS__, 'switch_mode' ) );
		}
		// The shop while it moves: only what the owner switched on here.
		if ( '1' === get_option( self::PAUSED ) || '1' === get_option( self::MOVED ) ) {
			add_filter( 'woocommerce_is_purchasable', '__return_false' );
			add_action( 'wp_body_open', array( __CLASS__, 'moving_notice' ) );
		}
		if ( '1' === get_option( self::MOVED ) && '' !== (string) get_option( self::SHOP, '' ) ) {
			add_action( 'template_redirect', array( __CLASS__, 'send_to_new_shop' ) );
		}
	}

	/**
	 * Buying paused: one line at the top of every page, while the shop moves.
	 */
	public static function moving_notice() {
		echo '<div class="kaizen-moving" role="status" style="padding:10px 16px;text-align:center;background:#111;color:#fff;font-size:15px">' . esc_html__( 'We are moving our shop. Buying is paused for a few minutes.', 'kaizen-store' ) . '</div>';
	}

	/**
	 * Shoppers sent to the new shop (permanent redirects): a product to its page, a category to its, the shop, the cart and the checkout to the
	 * new shop's front. Every other page of the site stays as it is.
	 */
	public static function send_to_new_shop() {
		if ( ! function_exists( 'is_product' ) ) {
			return;
		}
		$shop   = untrailingslashit( (string) get_option( self::SHOP, '' ) );
		$target = '';
		if ( is_product() ) {
			$target = $shop . '/p/' . rawurlencode( (string) get_post_field( 'post_name', get_queried_object_id() ) );
		} elseif ( is_product_category() ) {
			$term   = get_queried_object();
			$target = $shop . '/category/' . rawurlencode( $term && isset( $term->name ) ? sanitize_title( $term->name ) : '' );
		} elseif ( is_shop() || is_cart() || is_checkout() ) {
			$target = $shop;
		}
		if ( '' !== $target ) {
			wp_redirect( $target, 301 ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- the new shop is another site.
			exit;
		}
	}

	/**
	 * The owner's press on one of the two switches.
	 */
	public static function switch_mode() {
		if ( ! self::may() ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_mover_switch' );
		$which = isset( $_POST['which'] ) ? sanitize_key( wp_unslash( (string) $_POST['which'] ) ) : '';
		$on    = isset( $_POST['on'] ) && '1' === sanitize_key( wp_unslash( (string) $_POST['on'] ) );
		if ( 'paused' === $which ) {
			update_option( self::PAUSED, $on ? '1' : '0', true );
		} elseif ( 'moved' === $which && '' !== (string) get_option( self::SHOP, '' ) ) {
			update_option( self::MOVED, $on ? '1' : '0', true );
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/**
	 * One switch's form: what it does, and one button that turns it on or off.
	 *
	 * @param string $which  `paused` or `moved`.
	 * @param bool   $on     Whether it is on now.
	 * @param string $text   What it does.
	 * @param string $press  The button's words.
	 */
	private static function switch_form( $which, $on, $text, $press ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-bottom:12px">';
		wp_nonce_field( 'kaizen_store_mover_switch' );
		echo '<input type="hidden" name="action" value="kaizen_store_mover_switch" />';
		echo '<input type="hidden" name="which" value="' . esc_attr( $which ) . '" />';
		echo '<input type="hidden" name="on" value="' . ( $on ? '0' : '1' ) . '" />';
		echo '<p>' . esc_html( $text ) . '</p>';
		submit_button( $press, $on ? 'secondary' : 'primary', 'submit', false );
		echo '</form>';
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
		$shop = (string) get_option( self::SHOP, '' );
		if ( '' !== $shop ) {
			$paused = '1' === get_option( self::PAUSED );
			$moved  = '1' === get_option( self::MOVED );
			echo '<h2>' . esc_html__( 'Moving day', 'kaizen-store' ) . '</h2>';
			/* translators: %s: the new shop's address. */
			echo '<p>' . esc_html( sprintf( __( 'Your new shop: %s', 'kaizen-store' ), $shop ) ) . '</p>';
			self::switch_form( 'paused', $paused, $paused ? __( 'Buying is paused: shoppers see that you are moving.', 'kaizen-store' ) : __( 'Pause buying for the few minutes of the move, so no order is placed here while it moves.', 'kaizen-store' ), $paused ? __( 'Let shoppers buy again', 'kaizen-store' ) : __( 'Pause buying', 'kaizen-store' ) );
			self::switch_form( 'moved', $moved, $moved ? __( 'Shoppers are sent to the new shop: your products, categories, shop, cart and checkout lead there. Your other pages stay here.', 'kaizen-store' ) : __( 'Once your shop has moved, send shoppers to it: each product and category leads to its page in the new shop, and the shop, cart and checkout to its front. Your other pages stay here.', 'kaizen-store' ), $moved ? __( 'Keep shoppers here again', 'kaizen-store' ) : __( 'Send shoppers to the new shop', 'kaizen-store' ) );
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
		$shop = isset( $body['shop'] ) ? esc_url_raw( (string) $body['shop'] ) : '';
		if ( 0 === strpos( $shop, 'https://' ) ) {
			update_option( self::SHOP, $shop, false );
		}
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
		foreach ( array( 'plugins', 'redirects', 'seo', 'seo_terms', 'subscribers', 'gift_cards', 'content', 'menus' ) as $route ) {
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
	 * Yoast's and Rank Math's fields of a product, by our name: post meta keys, Yoast's first.
	 */
	const POST_FIELDS = array(
		'title'            => array( '_yoast_wpseo_title', 'rank_math_title' ),
		'description'      => array( '_yoast_wpseo_metadesc', 'rank_math_description' ),
		'focus_keyword'    => array( '_yoast_wpseo_focuskw', 'rank_math_focus_keyword' ),
		'canonical'        => array( '_yoast_wpseo_canonical', 'rank_math_canonical_url' ),
		'og_title'         => array( '_yoast_wpseo_opengraph-title', 'rank_math_facebook_title' ),
		'og_description'   => array( '_yoast_wpseo_opengraph-description', 'rank_math_facebook_description' ),
		'og_image'         => array( '_yoast_wpseo_opengraph-image', 'rank_math_facebook_image' ),
		'twitter_title'    => array( '_yoast_wpseo_twitter-title', 'rank_math_twitter_title' ),
		'twitter_description' => array( '_yoast_wpseo_twitter-description', 'rank_math_twitter_description' ),
		'twitter_image'    => array( '_yoast_wpseo_twitter-image', 'rank_math_twitter_image' ),
		'breadcrumb_title' => array( '_yoast_wpseo_bctitle', 'rank_math_breadcrumb_title' ),
		'primary_category' => array( '_yoast_wpseo_primary_product_cat', 'rank_math_primary_product_cat' ),
	);

	/**
	 * The same fields of a category: Yoast keeps them in one option by taxonomy and term, Rank Math as term meta.
	 */
	const TERM_FIELDS = array(
		'title'            => array( 'wpseo_title', 'rank_math_title' ),
		'description'      => array( 'wpseo_desc', 'rank_math_description' ),
		'focus_keyword'    => array( 'wpseo_focuskw', 'rank_math_focus_keyword' ),
		'canonical'        => array( 'wpseo_canonical', 'rank_math_canonical_url' ),
		'og_title'         => array( 'wpseo_opengraph-title', 'rank_math_facebook_title' ),
		'og_description'   => array( 'wpseo_opengraph-description', 'rank_math_facebook_description' ),
		'og_image'         => array( 'wpseo_opengraph-image', 'rank_math_facebook_image' ),
		'twitter_title'    => array( 'wpseo_twitter-title', 'rank_math_twitter_title' ),
		'twitter_description' => array( 'wpseo_twitter-description', 'rank_math_twitter_description' ),
		'twitter_image'    => array( 'wpseo_twitter-image', 'rank_math_twitter_image' ),
		'breadcrumb_title' => array( 'wpseo_bctitle', 'rank_math_breadcrumb_title' ),
	);

	/**
	 * A field's text as kept: a list (Rank Math's robots) joined with commas, anything else as text, tags taken out.
	 *
	 * @param mixed $value The kept value.
	 * @return string
	 */
	private static function text_of( $value ) {
		if ( is_array( $value ) ) {
			$value = implode( ', ', array_filter( array_map( 'strval', $value ) ) );
		}
		return trim( wp_strip_all_tags( (string) $value ) );
	}

	/**
	 * A title or description as the plugin itself shows it: its variables (`%%title%%`, `%title%`) replaced by the plugin's own function.
	 * Without the plugin's function, the text as kept.
	 *
	 * @param string $text   The kept text.
	 * @param string $plugin `yoast` or `rank-math`.
	 * @param mixed  $object The post or term it belongs to.
	 * @return string
	 */
	private static function shown( $text, $plugin, $object ) {
		if ( '' === $text || false === strpos( $text, '%' ) ) {
			return $text;
		}
		if ( 'yoast' === $plugin && function_exists( 'wpseo_replace_vars' ) ) {
			return trim( wp_strip_all_tags( (string) wpseo_replace_vars( $text, $object ) ) );
		}
		if ( 'rank-math' === $plugin && class_exists( '\RankMath\Helper' ) && method_exists( '\RankMath\Helper', 'replace_vars' ) ) {
			return trim( wp_strip_all_tags( (string) \RankMath\Helper::replace_vars( $text, $object ) ) );
		}
		return $text;
	}

	/**
	 * Robots, as both plugins keep it: Yoast's two flags, or Rank Math's list.
	 *
	 * @param callable $get Reads a key.
	 * @return string
	 */
	private static function robots( $get ) {
		$rank = self::text_of( $get( 'rank_math_robots' ) );
		if ( '' !== $rank ) {
			return $rank;
		}
		$out = array();
		$noindex = (string) $get( '_yoast_wpseo_meta-robots-noindex' );
		if ( '1' === $noindex || 'noindex' === (string) $get( 'wpseo_noindex' ) ) {
			$out[] = 'noindex';
		}
		if ( '1' === (string) $get( '_yoast_wpseo_meta-robots-nofollow' ) ) {
			$out[] = 'nofollow';
		}
		return implode( ', ', $out );
	}

	/**
	 * One thing's fields: each by its first key that holds something, with the plugin it came from; the title and description also as shown.
	 *
	 * @param array    $map    Our name to the keys.
	 * @param callable $get    Reads a key.
	 * @param mixed    $object The post or term, for the plugin's variables.
	 * @return array
	 */
	private static function fields_of( $map, $get, $object ) {
		$fields = array();
		$plugin = '';
		foreach ( $map as $name => $keys ) {
			foreach ( $keys as $n => $key ) {
				$value = self::text_of( $get( $key ) );
				if ( '' !== $value ) {
					$fields[ $name ] = $value;
					if ( '' === $plugin ) {
						$plugin = 0 === $n ? 'yoast' : 'rank-math';
					}
					break;
				}
			}
		}
		$robots = self::robots( $get );
		if ( '' !== $robots ) {
			$fields['robots'] = $robots;
		}
		if ( isset( $fields['primary_category'] ) && ctype_digit( $fields['primary_category'] ) ) {
			$term                       = get_term( (int) $fields['primary_category'], 'product_cat' );
			$fields['primary_category'] = $term && ! is_wp_error( $term ) ? $term->name : '';
		}
		return array(
			'plugin'      => $plugin,
			'title'       => isset( $fields['title'] ) ? self::shown( $fields['title'], $plugin, $object ) : '',
			'description' => isset( $fields['description'] ) ? self::shown( $fields['description'], $plugin, $object ) : '',
			'fields'      => array_filter( $fields, 'strlen' ),
		);
	}

	/**
	 * Yoast's or Rank Math's fields of the products asked for (`ids`, at most 100): every field kept as written, and the title and
	 * description as the plugin shows them.
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
			$get  = function ( $key ) use ( $id ) {
				return get_post_meta( $id, $key, true );
			};
			$seo  = self::fields_of( self::POST_FIELDS, $get, get_post( $id ) );
			if ( ! empty( $seo['fields'] ) ) {
				$out[] = array_merge( array( 'id' => $id ), $seo );
			}
		}
		return rest_ensure_response( array( 'seo' => $out ) );
	}

	/**
	 * The same of every product category, a page at a time: its name and address, and its fields.
	 *
	 * @param WP_REST_Request $request The request.
	 */
	public static function read_seo_terms( $request ) {
		$yoast = get_option( 'wpseo_taxonomy_meta', array() );
		$yoast = is_array( $yoast ) && isset( $yoast['product_cat'] ) && is_array( $yoast['product_cat'] ) ? $yoast['product_cat'] : array();
		$terms = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'hide_empty' => false,
				'number'     => self::PAGE_SIZE + 1,
				'offset'     => self::offset( $request ),
				'orderby'    => 'term_id',
			)
		);
		$terms = is_wp_error( $terms ) ? array() : $terms;
		$out   = array();
		foreach ( array_slice( $terms, 0, self::PAGE_SIZE ) as $term ) {
			$own = isset( $yoast[ $term->term_id ] ) && is_array( $yoast[ $term->term_id ] ) ? $yoast[ $term->term_id ] : array();
			$get = function ( $key ) use ( $own, $term ) {
				return isset( $own[ $key ] ) ? $own[ $key ] : get_term_meta( $term->term_id, $key, true );
			};
			$seo = self::fields_of( self::TERM_FIELDS, $get, $term );
			if ( ! empty( $seo['fields'] ) ) {
				$out[] = array_merge( array( 'name' => $term->name, 'slug' => $term->slug ), $seo );
			}
		}
		return rest_ensure_response(
			array(
				'terms' => $out,
				'more'  => count( $terms ) > self::PAGE_SIZE,
			)
		);
	}

	/**
	 * A column of a table, when it has it (the gift card plugins added columns over their versions).
	 *
	 * @param string $table  The table.
	 * @param string $column The column.
	 * @return bool
	 */
	private static function has_column( $table, $column ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table's name is this site's prefix.
		return null !== $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", $column ) );
	}

	/**
	 * A card as Kaizena Flow reads it: never its code (the new shop makes a new one), only its last four characters to tell it by.
	 *
	 * @param string     $source  The plugin.
	 * @param int        $id      The card's own id there.
	 * @param string     $code    The card's code, of which only the end is sent.
	 * @param float      $balance What is left on it.
	 * @param string     $expires When it expires (Y-m-d), or ''.
	 * @param string     $email   Whom it was for, or ''.
	 * @return array
	 */
	private static function card( $source, $id, $code, $balance, $expires, $email ) {
		return array(
			'source'  => $source,
			'id'      => (int) $id,
			'last4'   => strtoupper( substr( preg_replace( '/[^A-Za-z0-9]/', '', (string) $code ), -4 ) ),
			'balance' => number_format( (float) $balance, 2, '.', '' ),
			'expires' => (string) $expires,
			'email'   => sanitize_email( (string) $email ),
		);
	}

	/**
	 * The gift cards with money left, of WooCommerce Gift Cards, PW Gift Cards and YITH Gift Cards, in the shop's currency, a page at a time.
	 *
	 * @param WP_REST_Request $request The request.
	 */
	public static function read_gift_cards( $request ) {
		global $wpdb;
		$all = array();
		$wc  = $wpdb->prefix . 'woocommerce_gc_cards';
		if ( self::table_exists( $wc ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table's name is this site's prefix.
			$rows = $wpdb->get_results( "SELECT id, code, remaining, expire_date, recipient FROM {$wc} WHERE is_active = 'on' AND remaining > 0 ORDER BY id", ARRAY_A );
			foreach ( (array) $rows as $row ) {
				$expires = (int) $row['expire_date'] > 0 ? gmdate( 'Y-m-d', (int) $row['expire_date'] ) : '';
				$all[]   = self::card( 'woocommerce-gift-cards', $row['id'], $row['code'], $row['remaining'], $expires, $row['recipient'] );
			}
		}
		$pw       = $wpdb->prefix . 'pimwick_gift_card';
		$activity = $wpdb->prefix . 'pimwick_gift_card_activity';
		if ( self::table_exists( $pw ) && self::table_exists( $activity ) ) {
			$email = self::has_column( $pw, 'recipient_email' ) ? 'c.recipient_email' : "''";
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the tables' names are this site's prefix.
			$rows = $wpdb->get_results( "SELECT c.pimwick_gift_card_id AS id, c.number, c.expiration_date, {$email} AS email, COALESCE(SUM(a.amount), 0) AS balance FROM {$pw} c LEFT JOIN {$activity} a ON a.pimwick_gift_card_id = c.pimwick_gift_card_id WHERE c.active = 1 GROUP BY c.pimwick_gift_card_id HAVING balance > 0 ORDER BY c.pimwick_gift_card_id", ARRAY_A );
			foreach ( (array) $rows as $row ) {
				$expires = $row['expiration_date'] ? substr( (string) $row['expiration_date'], 0, 10 ) : '';
				$all[]   = self::card( 'pw-gift-cards', $row['id'], $row['number'], $row['balance'], $expires, $row['email'] );
			}
		}
		if ( post_type_exists( 'gift_card' ) ) {
			$cards = get_posts(
				array(
					'post_type'      => 'gift_card',
					'post_status'    => 'publish',
					'posts_per_page' => -1,
					'fields'         => 'ids',
				)
			);
			foreach ( $cards as $id ) {
				$balance = (float) get_post_meta( $id, '_ywgc_balance_total', true );
				if ( $balance <= 0 || 'yes' === get_post_meta( $id, '_ywgc_card_disabled', true ) ) {
					continue;
				}
				$expires = (int) get_post_meta( $id, '_ywgc_expiration', true );
				$all[]   = self::card( 'yith-gift-cards', $id, get_the_title( $id ), $balance, $expires > 0 ? gmdate( 'Y-m-d', $expires ) : '', get_post_meta( $id, '_ywgc_recipient', true ) );
			}
		}
		$offset = self::offset( $request );
		return rest_ensure_response(
			array(
				'cards'    => array_slice( $all, $offset, self::PAGE_SIZE ),
				'currency' => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '',
				'more'     => count( $all ) > $offset + self::PAGE_SIZE,
			)
		);
	}

	/**
	 * Pages or posts (`type` page or post), a page at a time: their address, title, state, author, and their content as HTML with every
	 * shortcode taken out (named, never run: a shortcode is another plugin's code) and blocks rendered. Drafts and private ones too.
	 *
	 * @param WP_REST_Request $request The request.
	 */
	public static function read_content( $request ) {
		$type  = 'post' === $request->get_param( 'type' ) ? 'post' : 'page';
		$posts = get_posts(
			array(
				'post_type'      => $type,
				'post_status'    => array( 'publish', 'draft', 'pending', 'private', 'future' ),
				'posts_per_page' => self::PAGE_SIZE + 1,
				'offset'         => self::offset( $request ),
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'suppress_filters' => true,
			)
		);
		$skip = array_filter( array( (int) get_option( 'woocommerce_shop_page_id' ), (int) get_option( 'woocommerce_cart_page_id' ), (int) get_option( 'woocommerce_checkout_page_id' ), (int) get_option( 'woocommerce_myaccount_page_id' ) ) );
		$out  = array();
		foreach ( array_slice( $posts, 0, self::PAGE_SIZE ) as $post ) {
			// The shop's own pages (shop, cart, checkout, my account) are the new shop's own.
			if ( in_array( (int) $post->ID, $skip, true ) ) {
				continue;
			}
			$raw = (string) $post->post_content;
			preg_match_all( '/\[([a-zA-Z][a-zA-Z0-9_-]*)[^\]]*\]/', $raw, $found );
			$text = strip_shortcodes( $raw );
			// Shortcodes no plugin registers any more are taken out by their brackets too.
			$text = preg_replace( '/\[\/?[a-zA-Z][a-zA-Z0-9_-]*[^\]]*\]/', '', $text );
			$html = has_blocks( $text ) ? do_blocks( $text ) : wpautop( $text );
			$author = get_the_author_meta( 'display_name', (int) $post->post_author );
			$out[]  = array(
				'id'         => (int) $post->ID,
				'slug'       => $post->post_name ? $post->post_name : sanitize_title( $post->post_title ),
				'title'      => wp_strip_all_tags( get_the_title( $post ) ),
				'html'       => $html,
				'published'  => 'publish' === $post->post_status,
				'author'     => wp_strip_all_tags( (string) $author ),
				'shortcodes' => array_values( array_unique( array_map( 'strtolower', $found[1] ) ) ),
			);
		}
		return rest_ensure_response(
			array(
				'items' => $out,
				'more'  => count( $posts ) > self::PAGE_SIZE,
			)
		);
	}

	/**
	 * The site's menus, three levels deep: each item's words, what it is (the front page, the shop, a page, a post, a product, a category or
	 * an address) and where it leads, as the new shop names its own addresses.
	 */
	public static function read_menus() {
		$shop  = (int) get_option( 'woocommerce_shop_page_id' );
		$front = (int) get_option( 'page_on_front' );
		$home  = untrailingslashit( home_url() );
		$out   = array();
		foreach ( wp_get_nav_menus() as $menu ) {
			$items = wp_get_nav_menu_items( $menu->term_id );
			$nodes = array();
			foreach ( (array) $items as $item ) {
				$object = (string) $item->object;
				$id     = (int) $item->object_id;
				$type   = 'HTTP';
				$url    = (string) $item->url;
				if ( 'page' === $object && $id === $shop ) {
					$type = 'CATALOG';
				} elseif ( ( 'page' === $object && $id === $front ) || untrailingslashit( $url ) === $home ) {
					$type = 'FRONTPAGE';
				} elseif ( 'page' === $object ) {
					$type = 'PAGE';
					$url  = '/pages/' . get_post_field( 'post_name', $id );
				} elseif ( 'post' === $object ) {
					$type = 'ARTICLE';
					$url  = '/blogs/news/' . get_post_field( 'post_name', $id );
				} elseif ( 'product' === $object ) {
					$type = 'PRODUCT';
					$url  = '/products/' . get_post_field( 'post_name', $id );
				} elseif ( 'product_cat' === $object ) {
					$term = get_term( $id, 'product_cat' );
					$type = 'COLLECTION';
					$url  = '/collections/' . ( $term && ! is_wp_error( $term ) ? sanitize_title( $term->name ) : '' );
				} elseif ( 0 === strpos( $url, $home . '/' ) ) {
					$url = substr( $url, strlen( $home ) );
				}
				$nodes[ (int) $item->ID ] = array(
					'parent' => (int) $item->menu_item_parent,
					'node'   => array( 'title' => wp_strip_all_tags( (string) $item->title ), 'type' => $type, 'url' => $url, 'items' => array() ),
				);
			}
			// Each item under its parent, in the menu's own order, three levels deep (as many as a menu here holds).
			$tree = array();
			foreach ( $nodes as $id => $entry ) {
				if ( ! $entry['parent'] || ! isset( $nodes[ $entry['parent'] ] ) ) {
					$tree[] = self::with_children( $id, $nodes, 0 );
				}
			}
			$out[] = array( 'handle' => $menu->slug, 'title' => $menu->name, 'items' => $tree );
		}
		return rest_ensure_response( array( 'menus' => $out ) );
	}

	/**
	 * An item with its children, and theirs, to three levels.
	 *
	 * @param int   $id    The item.
	 * @param array $nodes Every item with its parent and node.
	 * @param int   $depth How deep this item is.
	 * @return array
	 */
	private static function with_children( $id, $nodes, $depth ) {
		$node = $nodes[ $id ]['node'];
		if ( $depth < 2 ) {
			foreach ( $nodes as $child => $entry ) {
				if ( $entry['parent'] === $id ) {
					$node['items'][] = self::with_children( $child, $nodes, $depth + 1 );
				}
			}
		}
		return $node;
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
