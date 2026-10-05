<?php
/**
 * Saved views: a view is what a shortcode shows (which store and market, which products, grid or carousel, how many columns). Each is
 * a post of the private type `kaizen_view`, its settings kept as one JSON value, so a view is made once and used on any page as
 * [kaizen_products id="123"].
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Views {

	const POST_TYPE = 'kaizen_view';
	const META_KEY  = '_kaizen_view';
	const UUID      = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'register' ) );
		add_filter( 'manage_' . self::POST_TYPE . '_posts_columns', array( __CLASS__, 'columns' ) );
		add_action( 'manage_' . self::POST_TYPE . '_posts_custom_column', array( __CLASS__, 'column' ), 10, 2 );
		add_filter( 'post_row_actions', array( __CLASS__, 'row_actions' ), 10, 2 );
		add_action( 'admin_post_kaizen_store_duplicate', array( __CLASS__, 'duplicate' ) );
		add_filter( 'enter_title_here', array( __CLASS__, 'title_placeholder' ), 10, 2 );
	}

	public static function register() {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'               => __( 'Kaizen views', 'kaizen-store' ),
					'singular_name'      => __( 'Kaizen view', 'kaizen-store' ),
					'menu_name'          => __( 'Views', 'kaizen-store' ),
					'add_new'            => __( 'Add view', 'kaizen-store' ),
					'add_new_item'       => __( 'Add a view', 'kaizen-store' ),
					'edit_item'          => __( 'Edit view', 'kaizen-store' ),
					'new_item'           => __( 'New view', 'kaizen-store' ),
					'view_item'          => __( 'View', 'kaizen-store' ),
					'search_items'       => __( 'Search views', 'kaizen-store' ),
					'not_found'          => __( 'No views yet. Add one to get a shortcode.', 'kaizen-store' ),
					'not_found_in_trash' => __( 'No views in the trash.', 'kaizen-store' ),
					'all_items'          => __( 'Views', 'kaizen-store' ),
				),
				'public'              => false,
				'show_ui'             => true,
				'show_in_menu'        => 'kaizen-store',
				'show_in_rest'        => false,
				'exclude_from_search' => true,
				'publicly_queryable'  => false,
				'has_archive'         => false,
				'rewrite'             => false,
				'supports'            => array( 'title' ),
				'capability_type'     => 'kaizen_view',
				'map_meta_cap'        => true,
				'capabilities'        => array(
					'edit_posts'             => 'manage_options',
					'edit_others_posts'      => 'manage_options',
					'edit_published_posts'   => 'manage_options',
					'edit_private_posts'     => 'manage_options',
					'publish_posts'          => 'manage_options',
					'read_private_posts'     => 'manage_options',
					'delete_posts'           => 'manage_options',
					'delete_private_posts'   => 'manage_options',
					'delete_published_posts' => 'manage_options',
					'delete_others_posts'    => 'manage_options',
					'create_posts'           => 'manage_options',
				),
			)
		);
	}

	public static function title_placeholder( $title, $post ) {
		return self::POST_TYPE === $post->post_type ? __( 'Name this view, for example "Bestsellers on the front page"', 'kaizen-store' ) : $title;
	}

	/**
	 * The settings of a view with everything that was not chosen at its default.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'store'        => '',
			'store_name'   => '',
			'market'       => '',
			'source'       => 'all',
			'categories'   => array(),
			'tags'         => array(),
			'products'     => array(),
			'sort'         => 'newest',
			'limit'        => 12,
			'layout'       => 'grid',
			'columns'      => 4,
			'show_price'   => 1,
			'show_excerpt' => 0,
			'show_button'  => 1,
			'button_text'  => '',
			'new_tab'      => 0,
		);
	}

	/**
	 * Settings from anything a form or a database may hold: every value is checked, nothing unknown is kept.
	 *
	 * @param mixed $raw Posted or stored settings.
	 * @return array
	 */
	public static function sanitize( $raw ) {
		$raw = is_array( $raw ) ? $raw : array();
		$out = self::defaults();

		$out['store']      = isset( $raw['store'] ) && preg_match( '/^[a-z0-9-]{3,40}$/', (string) $raw['store'] ) ? (string) $raw['store'] : '';
		$out['store_name'] = isset( $raw['store_name'] ) ? mb_substr( sanitize_text_field( (string) $raw['store_name'] ), 0, 120 ) : '';
		$out['market']     = isset( $raw['market'] ) && preg_match( '/^[a-z0-9-]{2,40}$/', (string) $raw['market'] ) ? (string) $raw['market'] : '';
		$out['source']     = isset( $raw['source'] ) && in_array( $raw['source'], array( 'all', 'category', 'tag', 'products' ), true ) ? $raw['source'] : 'all';
		$out['sort']       = isset( $raw['sort'] ) && in_array( $raw['sort'], array( 'newest', 'oldest', 'title', 'priceLow', 'priceHigh' ), true ) ? $raw['sort'] : 'newest';
		$out['layout']     = isset( $raw['layout'] ) && 'carousel' === $raw['layout'] ? 'carousel' : 'grid';
		$out['limit']      = self::clamp( isset( $raw['limit'] ) ? $raw['limit'] : 12, 1, 48, 12 );
		$out['columns']    = self::clamp( isset( $raw['columns'] ) ? $raw['columns'] : 4, 1, 6, 4 );

		foreach ( array( 'categories', 'tags' ) as $key ) {
			$out[ $key ] = array();
			if ( isset( $raw[ $key ] ) && is_array( $raw[ $key ] ) ) {
				foreach ( $raw[ $key ] as $id ) {
					if ( is_string( $id ) && preg_match( self::UUID, $id ) && ! in_array( strtolower( $id ), $out[ $key ], true ) ) {
						$out[ $key ][] = strtolower( $id );
					}
				}
				$out[ $key ] = array_slice( $out[ $key ], 0, 48 );
			}
		}

		// Hand-picked products: a list of { id, title }, in the order picked (a JSON text when posted).
		$products = isset( $raw['products'] ) ? $raw['products'] : array();
		if ( is_string( $products ) ) {
			$products = json_decode( $products, true );
		}
		$out['products'] = array();
		if ( is_array( $products ) ) {
			foreach ( $products as $product ) {
				$id = is_array( $product ) && isset( $product['id'] ) ? (string) $product['id'] : '';
				if ( ! preg_match( self::UUID, $id ) ) {
					continue;
				}
				$id = strtolower( $id );
				foreach ( $out['products'] as $have ) {
					if ( $have['id'] === $id ) {
						continue 2;
					}
				}
				$out['products'][] = array(
					'id'    => $id,
					'title' => isset( $product['title'] ) ? mb_substr( sanitize_text_field( (string) $product['title'] ), 0, 200 ) : '',
				);
				if ( count( $out['products'] ) >= 48 ) {
					break;
				}
			}
		}

		foreach ( array( 'show_price', 'show_excerpt', 'show_button', 'new_tab' ) as $flag ) {
			$out[ $flag ] = ! empty( $raw[ $flag ] ) ? 1 : 0;
		}
		$out['button_text'] = isset( $raw['button_text'] ) ? mb_substr( sanitize_text_field( (string) $raw['button_text'] ), 0, 40 ) : '';
		return $out;
	}

	private static function clamp( $value, $min, $max, $default ) {
		if ( ! is_numeric( $value ) ) {
			return $default;
		}
		return max( $min, min( $max, (int) $value ) );
	}

	/**
	 * A saved view's settings.
	 *
	 * @param int $post_id The view's post.
	 * @return array|null Null when it is not a view.
	 */
	public static function get( $post_id ) {
		$post = get_post( (int) $post_id );
		if ( ! $post || self::POST_TYPE !== $post->post_type || 'publish' !== $post->post_status ) {
			return null;
		}
		$stored = get_post_meta( $post->ID, self::META_KEY, true );
		$value  = is_string( $stored ) ? json_decode( $stored, true ) : null;
		return self::sanitize( is_array( $value ) ? $value : array() );
	}

	/**
	 * Keeps a view's settings (the editor has already checked the nonce and the right to edit).
	 *
	 * @param int   $post_id  The view's post.
	 * @param array $settings Settings from the form.
	 */
	public static function save( $post_id, $settings ) {
		update_post_meta( $post_id, self::META_KEY, wp_slash( wp_json_encode( self::sanitize( $settings ) ) ) );
		Kaizen_Store_Render::clear_cache();
	}

	/**
	 * The shortcode of a view.
	 *
	 * @param int $post_id The view's post.
	 * @return string
	 */
	public static function shortcode( $post_id ) {
		return '[kaizen_products id="' . (int) $post_id . '"]';
	}

	public static function columns( $columns ) {
		$out = array();
		foreach ( $columns as $key => $label ) {
			$out[ $key ] = $label;
			if ( 'title' === $key ) {
				$out['kaizen_shortcode'] = __( 'Shortcode', 'kaizen-store' );
				$out['kaizen_store']     = __( 'Store', 'kaizen-store' );
				$out['kaizen_layout']    = __( 'Layout', 'kaizen-store' );
			}
		}
		return $out;
	}

	public static function column( $column, $post_id ) {
		$stored = get_post_meta( $post_id, self::META_KEY, true );
		$config = self::sanitize( is_string( $stored ) ? json_decode( $stored, true ) : array() );
		if ( 'kaizen_shortcode' === $column ) {
			echo '<code class="kaizen-copy" title="' . esc_attr__( 'Click to select', 'kaizen-store' ) . '">' . esc_html( self::shortcode( $post_id ) ) . '</code>';
		} elseif ( 'kaizen_store' === $column ) {
			echo esc_html( '' !== $config['store_name'] ? $config['store_name'] : ( '' !== $config['store'] ? $config['store'] : '-' ) );
		} elseif ( 'kaizen_layout' === $column ) {
			/* translators: 1: layout name, 2: number of columns. */
			echo esc_html( sprintf( __( '%1$s, %2$d columns', 'kaizen-store' ), 'carousel' === $config['layout'] ? __( 'Carousel', 'kaizen-store' ) : __( 'Grid', 'kaizen-store' ), $config['columns'] ) );
		}
	}

	public static function row_actions( $actions, $post ) {
		if ( self::POST_TYPE === $post->post_type && current_user_can( 'manage_options' ) && 'trash' !== $post->post_status ) {
			$url                  = wp_nonce_url( admin_url( 'admin-post.php?action=kaizen_store_duplicate&post=' . (int) $post->ID ), 'kaizen_store_duplicate_' . (int) $post->ID );
			$actions['duplicate'] = '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Duplicate', 'kaizen-store' ) . '</a>';
		}
		return $actions;
	}

	/**
	 * Copies a view, to start another from it.
	 */
	public static function duplicate() {
		$id = isset( $_GET['post'] ) ? (int) $_GET['post'] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- checked below.
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kaizen-store' ), 403 );
		}
		check_admin_referer( 'kaizen_store_duplicate_' . $id );
		$post = get_post( $id );
		if ( ! $post || self::POST_TYPE !== $post->post_type ) {
			wp_die( esc_html__( 'That view does not exist.', 'kaizen-store' ), 404 );
		}
		$copy = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'publish',
				/* translators: %s: the name of the view that is copied. */
				'post_title'  => sprintf( __( 'Copy of %s', 'kaizen-store' ), $post->post_title ),
			)
		);
		if ( $copy && ! is_wp_error( $copy ) ) {
			$stored = get_post_meta( $id, self::META_KEY, true );
			if ( is_string( $stored ) && '' !== $stored ) {
				update_post_meta( $copy, self::META_KEY, wp_slash( $stored ) );
			}
		}
		wp_safe_redirect( admin_url( 'edit.php?post_type=' . self::POST_TYPE ) );
		exit;
	}

	/**
	 * What to ask Kaizen for a view's products.
	 *
	 * @param array $config A view's settings.
	 * @return array
	 */
	public static function query( $config ) {
		$query = array(
			'source' => $config['source'],
			'sort'   => 'products' === $config['source'] ? 'given' : $config['sort'],
			'limit'  => $config['limit'],
		);
		if ( '' !== $config['market'] ) {
			$query['market'] = $config['market'];
		}
		if ( 'category' === $config['source'] ) {
			$query['categories'] = implode( ',', $config['categories'] );
		} elseif ( 'tag' === $config['source'] ) {
			$query['tags'] = implode( ',', $config['tags'] );
		} elseif ( 'products' === $config['source'] ) {
			$query['ids'] = implode( ',', wp_list_pluck( $config['products'], 'id' ) );
		}
		return $query;
	}
}
