<?php
/**
 * The admin: the Kaizen menu with the connection page, and the editor of a view (a box on the view's own screen) with its live preview.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'add_meta_boxes_' . Kaizen_Store_Views::POST_TYPE, array( __CLASS__, 'meta_boxes' ) );
		add_action( 'save_post_' . Kaizen_Store_Views::POST_TYPE, array( __CLASS__, 'save_view' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'wp_ajax_kaizen_store_stores', array( __CLASS__, 'ajax_stores' ) );
		add_action( 'wp_ajax_kaizen_store_terms', array( __CLASS__, 'ajax_terms' ) );
		add_action( 'wp_ajax_kaizen_store_products', array( __CLASS__, 'ajax_products' ) );
		add_action( 'wp_ajax_kaizen_store_preview', array( __CLASS__, 'ajax_preview' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( KAIZEN_STORE_FILE ), array( __CLASS__, 'plugin_links' ) );
		add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
	}

	public static function body_class( $classes ) {
		return $classes;
	}

	public static function plugin_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( Kaizen_Store_Connect::page_url() ) . '">' . esc_html__( 'Connection', 'kaizen-store' ) . '</a>' );
		return $links;
	}

	public static function menu() {
		add_menu_page(
			__( 'Kaizen Store', 'kaizen-store' ),
			__( 'Kaizen', 'kaizen-store' ),
			'manage_options',
			Kaizen_Store_Connect::PAGE,
			array( __CLASS__, 'connection_page' ),
			'dashicons-cart',
			58
		);
		// The first entry of the menu is the connection; the views come under it.
		add_submenu_page( Kaizen_Store_Connect::PAGE, __( 'Connection', 'kaizen-store' ), __( 'Connection', 'kaizen-store' ), 'manage_options', Kaizen_Store_Connect::PAGE, array( __CLASS__, 'connection_page' ) );
	}

	private static function on_our_screen() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		return $screen && ( Kaizen_Store_Views::POST_TYPE === $screen->post_type || false !== strpos( (string) $screen->id, Kaizen_Store_Connect::PAGE ) );
	}

	public static function assets() {
		if ( ! self::on_our_screen() ) {
			return;
		}
		wp_enqueue_style( 'kaizen-store-admin', KAIZEN_STORE_URL . 'assets/admin.css', array(), KAIZEN_STORE_VERSION );
		$screen = get_current_screen();
		if ( $screen && Kaizen_Store_Views::POST_TYPE === $screen->post_type && 'post' === $screen->base ) {
			wp_enqueue_style( 'kaizen-store', KAIZEN_STORE_URL . 'assets/frontend.css', array(), KAIZEN_STORE_VERSION );
			wp_enqueue_script( 'kaizen-store-admin', KAIZEN_STORE_URL . 'assets/admin.js', array(), KAIZEN_STORE_VERSION, true );
			wp_enqueue_script( 'kaizen-store', KAIZEN_STORE_URL . 'assets/frontend.js', array(), KAIZEN_STORE_VERSION, true );
			$post   = get_post();
			$stored = $post ? get_post_meta( $post->ID, Kaizen_Store_Views::META_KEY, true ) : '';
			wp_localize_script(
				'kaizen-store-admin',
				'KaizenStoreAdmin',
				array(
					'ajax'      => admin_url( 'admin-ajax.php' ),
					'nonce'     => wp_create_nonce( 'kaizen_store_admin' ),
					'connected' => Kaizen_Store_Settings::is_connected(),
					'config'    => Kaizen_Store_Views::sanitize( is_string( $stored ) ? json_decode( $stored, true ) : array() ),
					'text'      => array(
						'loading'      => __( 'Loading…', 'kaizen-store' ),
						'chooseStore'  => __( 'Choose a store', 'kaizen-store' ),
						'notOpen'      => __( '(not open yet)', 'kaizen-store' ),
						'noMarkets'    => __( 'This store has no markets.', 'kaizen-store' ),
						'noCategories' => __( 'This store has no categories.', 'kaizen-store' ),
						'noTags'       => __( 'This store has no tags.', 'kaizen-store' ),
						'search'       => __( 'Search products by name', 'kaizen-store' ),
						'noProducts'   => __( 'No products found.', 'kaizen-store' ),
						'add'          => __( 'Add', 'kaizen-store' ),
						'remove'       => __( 'Remove', 'kaizen-store' ),
						'up'           => __( 'Move up', 'kaizen-store' ),
						'down'         => __( 'Move down', 'kaizen-store' ),
						'nothingPicked' => __( 'No products picked yet.', 'kaizen-store' ),
						'error'        => __( 'Kaizen could not be reached. Try again in a moment.', 'kaizen-store' ),
						'previewing'   => __( 'Loading preview…', 'kaizen-store' ),
						'copied'       => __( 'Copied', 'kaizen-store' ),
					),
				)
			);
		}
	}

	// -------------------------------------------------------------------------------------------------------------
	// The connection page.
	// -------------------------------------------------------------------------------------------------------------

	private static function notices() {
		$notice = isset( $_GET['kaizen_notice'] ) ? sanitize_key( wp_unslash( $_GET['kaizen_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$known  = array(
			'connected'      => array( 'success', __( 'Connected. Your stores are ready to use in a view.', 'kaizen-store' ) ),
			'disconnected'   => array( 'success', __( 'Disconnected. Your saved views stay, and show nothing until you connect again.', 'kaizen-store' ) ),
			'denied'         => array( 'warning', __( 'The connection was cancelled in Kaizen.', 'kaizen-store' ) ),
			'expired'        => array( 'error', __( 'That connection attempt has expired. Choose Connect to Kaizen to start again.', 'kaizen-store' ) ),
			'failed'         => array( 'error', __( 'Kaizen would not accept the connection. Choose Connect to Kaizen to start again.', 'kaizen-store' ) ),
			'https'          => array( 'error', __( 'Kaizen only connects sites that use https. Switch this site to https, then try again.', 'kaizen-store' ) ),
			'cache'          => array( 'success', __( 'The saved product lists were cleared. Pages show current products from now on.', 'kaizen-store' ) ),
			'address'        => array( 'success', __( 'Kaizen\'s address was saved.', 'kaizen-store' ) ),
			'address_locked' => array( 'error', __( 'Disconnect before changing Kaizen\'s address.', 'kaizen-store' ) ),
		);
		if ( isset( $known[ $notice ] ) ) {
			echo '<div class="notice notice-' . esc_attr( $known[ $notice ][0] ) . ' is-dismissible"><p>' . esc_html( $known[ $notice ][1] ) . '</p></div>';
		}
	}

	public static function connection_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to see this page.', 'kaizen-store' ), 403 );
		}
		echo '<div class="wrap kaizen-admin"><h1>' . esc_html__( 'Kaizen Store', 'kaizen-store' ) . '</h1>';
		self::notices();
		if ( Kaizen_Store_Settings::is_connected() ) {
			self::connected_panel();
		} else {
			self::connect_panel();
		}
		echo '</div>';
	}

	private static function connect_panel() {
		?>
		<div class="kaizen-panel">
			<h2><?php esc_html_e( 'Connect this site to your stores', 'kaizen-store' ); ?></h2>
			<p><?php esc_html_e( 'Show products from your Kaizen Store stores on this site, as a grid or a carousel, with a shortcode. You sign in on Kaizen and approve this site there: your password never comes here. This site can then read the products, prices and pictures your stores show shoppers, and nothing else.', 'kaizen-store' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="kaizen_store_connect">
				<?php wp_nonce_field( 'kaizen_store_connect' ); ?>
				<?php submit_button( __( 'Connect to Kaizen', 'kaizen-store' ), 'primary', 'submit', false ); ?>
			</form>
			<details class="kaizen-advanced">
				<summary><?php esc_html_e( 'Advanced', 'kaizen-store' ); ?></summary>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="kaizen_store_save_address">
					<?php wp_nonce_field( 'kaizen_store_save_address' ); ?>
					<p><label for="kaizen_api_url"><?php esc_html_e( 'Kaizen\'s address (leave as it is unless you were told otherwise)', 'kaizen-store' ); ?></label><br>
					<input type="url" id="kaizen_api_url" name="kaizen_api_url" class="regular-text" value="<?php echo esc_attr( Kaizen_Store_Settings::api_url() ); ?>"></p>
					<?php submit_button( __( 'Save address', 'kaizen-store' ), 'secondary', 'submit', false ); ?>
				</form>
			</details>
		</div>
		<?php
	}

	private static function connected_panel() {
		$connection = Kaizen_Store_Settings::connection();
		$check      = Kaizen_Store_Api::stores();
		$views      = wp_count_posts( Kaizen_Store_Views::POST_TYPE );
		$view_count = isset( $views->publish ) ? (int) $views->publish : 0;
		?>
		<div class="kaizen-panel">
			<h2><?php esc_html_e( 'Connected', 'kaizen-store' ); ?></h2>
			<?php if ( is_wp_error( $check ) ) : ?>
				<div class="notice notice-error inline"><p>
					<?php echo esc_html( $check->get_error_message() ); ?>
					<?php if ( Kaizen_Store_Api::is_unauthorized( $check ) ) : ?>
						<?php esc_html_e( 'Disconnect and connect again.', 'kaizen-store' ); ?>
					<?php endif; ?>
				</p></div>
			<?php else : ?>
				<p>
					<?php
					/* translators: %s: email address of the Kaizen account. */
					echo esc_html( sprintf( __( 'Signed in to Kaizen as %s.', 'kaizen-store' ), isset( $connection['email'] ) ? $connection['email'] : '' ) );
					?>
				</p>
				<?php if ( ! empty( $check['stores'] ) ) : ?>
					<table class="widefat striped kaizen-stores">
						<thead><tr><th><?php esc_html_e( 'Store', 'kaizen-store' ); ?></th><th><?php esc_html_e( 'Markets', 'kaizen-store' ); ?></th><th><?php esc_html_e( 'Status', 'kaizen-store' ); ?></th></tr></thead>
						<tbody>
						<?php foreach ( $check['stores'] as $store ) : ?>
							<tr>
								<td><strong><?php echo esc_html( $store['name'] ); ?></strong><br><span class="description"><?php echo esc_html( $store['slug'] ); ?></span></td>
								<td><?php echo esc_html( implode( ', ', wp_list_pluck( $store['markets'], 'name' ) ) ); ?></td>
								<td><?php echo ! empty( $store['open'] ) ? esc_html__( 'Open', 'kaizen-store' ) : esc_html__( 'Not open to shoppers', 'kaizen-store' ); ?></td>
							</tr>
						<?php endforeach; ?>
						</tbody>
					</table>
				<?php else : ?>
					<p><?php esc_html_e( 'No stores are connected to this Kaizen account yet.', 'kaizen-store' ); ?></p>
				<?php endif; ?>
			<?php endif; ?>
			<p class="kaizen-actions">
				<a class="button button-primary" href="<?php echo esc_url( admin_url( 'post-new.php?post_type=' . Kaizen_Store_Views::POST_TYPE ) ); ?>"><?php esc_html_e( 'Add a view', 'kaizen-store' ); ?></a>
				<a class="button" href="<?php echo esc_url( admin_url( 'edit.php?post_type=' . Kaizen_Store_Views::POST_TYPE ) ); ?>">
					<?php
					/* translators: %d: number of saved views. */
					echo esc_html( sprintf( _n( '%d saved view', '%d saved views', $view_count, 'kaizen-store' ), $view_count ) );
					?>
				</a>
			</p>
		</div>
		<div class="kaizen-panel">
			<h2><?php esc_html_e( 'Products on your pages', 'kaizen-store' ); ?></h2>
			<p><?php esc_html_e( 'Product lists are kept for ten minutes so your pages stay fast, so a changed price or a new product shows within that time. Clear them to show current products at once.', 'kaizen-store' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="kaizen-inline">
				<input type="hidden" name="action" value="kaizen_store_clear_cache">
				<?php wp_nonce_field( 'kaizen_store_clear_cache' ); ?>
				<?php submit_button( __( 'Clear saved product lists', 'kaizen-store' ), 'secondary', 'submit', false ); ?>
			</form>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="kaizen-inline">
				<input type="hidden" name="action" value="kaizen_store_disconnect">
				<?php wp_nonce_field( 'kaizen_store_disconnect' ); ?>
				<?php submit_button( __( 'Disconnect from Kaizen', 'kaizen-store' ), 'delete', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}

	// -------------------------------------------------------------------------------------------------------------
	// The editor of a view.
	// -------------------------------------------------------------------------------------------------------------

	public static function meta_boxes() {
		add_meta_box( 'kaizen_view_settings', __( 'What this view shows', 'kaizen-store' ), array( __CLASS__, 'settings_box' ), Kaizen_Store_Views::POST_TYPE, 'normal', 'high' );
		add_meta_box( 'kaizen_view_shortcode', __( 'Shortcode', 'kaizen-store' ), array( __CLASS__, 'shortcode_box' ), Kaizen_Store_Views::POST_TYPE, 'side', 'high' );
	}

	public static function shortcode_box( $post ) {
		if ( 'auto-draft' === $post->post_status ) {
			echo '<p>' . esc_html__( 'Save the view to get its shortcode.', 'kaizen-store' ) . '</p>';
			return;
		}
		$code = Kaizen_Store_Views::shortcode( $post->ID );
		echo '<p><input type="text" class="widefat kaizen-copy" readonly value="' . esc_attr( $code ) . '" onfocus="this.select()"></p>';
		echo '<p class="description">' . esc_html__( 'Paste it into any page, post or widget that takes shortcodes. Change the view later and every place that uses it follows.', 'kaizen-store' ) . '</p>';
		echo '<p class="description">' . esc_html__( 'You can change a use of it: layout="carousel", columns="3" or limit="6".', 'kaizen-store' ) . '</p>';
	}

	public static function settings_box( $post ) {
		wp_nonce_field( 'kaizen_store_save_view', 'kaizen_store_view_nonce' );
		if ( ! Kaizen_Store_Settings::is_connected() ) {
			echo '<p>' . esc_html__( 'Connect this site to Kaizen first.', 'kaizen-store' ) . ' <a href="' . esc_url( Kaizen_Store_Connect::page_url() ) . '">' . esc_html__( 'Open the connection', 'kaizen-store' ) . '</a></p>';
			return;
		}
		$stored = get_post_meta( $post->ID, Kaizen_Store_Views::META_KEY, true );
		$c      = Kaizen_Store_Views::sanitize( is_string( $stored ) ? json_decode( $stored, true ) : array() );
		?>
		<div class="kaizen-editor" data-kaizen-editor>
			<p class="kaizen-error" role="alert" hidden></p>
			<div class="kaizen-row">
				<p>
					<label for="kaizen-store"><strong><?php esc_html_e( 'Store', 'kaizen-store' ); ?></strong></label><br>
					<select id="kaizen-store" name="kaizen_view[store]">
						<option value="<?php echo esc_attr( $c['store'] ); ?>"><?php echo esc_html( '' !== $c['store'] ? ( '' !== $c['store_name'] ? $c['store_name'] : $c['store'] ) : __( 'Choose a store', 'kaizen-store' ) ); ?></option>
					</select>
					<input type="hidden" name="kaizen_view[store_name]" value="<?php echo esc_attr( $c['store_name'] ); ?>">
				</p>
				<p>
					<label for="kaizen-market"><strong><?php esc_html_e( 'Market (country, language and currency of the prices)', 'kaizen-store' ); ?></strong></label><br>
					<select id="kaizen-market" name="kaizen_view[market]">
						<option value="<?php echo esc_attr( $c['market'] ); ?>"><?php echo esc_html( '' !== $c['market'] ? $c['market'] : __( 'The store\'s first market', 'kaizen-store' ) ); ?></option>
					</select>
				</p>
			</div>

			<fieldset class="kaizen-fieldset">
				<legend><strong><?php esc_html_e( 'Products', 'kaizen-store' ); ?></strong></legend>
				<?php
				$sources = array(
					'all'      => __( 'All products', 'kaizen-store' ),
					'category' => __( 'Products in categories', 'kaizen-store' ),
					'tag'      => __( 'Products with tags', 'kaizen-store' ),
					'products' => __( 'Products I pick', 'kaizen-store' ),
				);
				foreach ( $sources as $value => $label ) {
					echo '<label class="kaizen-radio"><input type="radio" name="kaizen_view[source]" value="' . esc_attr( $value ) . '"' . checked( $c['source'], $value, false ) . '> ' . esc_html( $label ) . '</label> ';
				}
				?>
				<div class="kaizen-source" data-source="category" hidden><div class="kaizen-checks" data-terms="categories"></div></div>
				<div class="kaizen-source" data-source="tag" hidden><div class="kaizen-checks" data-terms="tags"></div></div>
				<div class="kaizen-source" data-source="products" hidden>
					<p><input type="search" class="regular-text" data-pick-search placeholder="<?php esc_attr_e( 'Search products by name', 'kaizen-store' ); ?>"></p>
					<ul class="kaizen-pick-results" data-pick-results></ul>
					<p><strong><?php esc_html_e( 'Picked, in this order', 'kaizen-store' ); ?></strong></p>
					<ol class="kaizen-picked" data-picked></ol>
					<input type="hidden" name="kaizen_view[products]" value="<?php echo esc_attr( wp_json_encode( $c['products'] ) ); ?>" data-products-field>
				</div>
			</fieldset>

			<div class="kaizen-row">
				<p data-sort-field>
					<label for="kaizen-sort"><strong><?php esc_html_e( 'Order', 'kaizen-store' ); ?></strong></label><br>
					<select id="kaizen-sort" name="kaizen_view[sort]">
						<?php
						$sorts = array(
							'newest'    => __( 'Newest first', 'kaizen-store' ),
							'oldest'    => __( 'Oldest first', 'kaizen-store' ),
							'title'     => __( 'By name', 'kaizen-store' ),
							'priceLow'  => __( 'Cheapest first', 'kaizen-store' ),
							'priceHigh' => __( 'Most expensive first', 'kaizen-store' ),
						);
						foreach ( $sorts as $value => $label ) {
							echo '<option value="' . esc_attr( $value ) . '"' . selected( $c['sort'], $value, false ) . '>' . esc_html( $label ) . '</option>';
						}
						?>
					</select>
				</p>
				<p>
					<label for="kaizen-limit"><strong><?php esc_html_e( 'Number of products (up to 48)', 'kaizen-store' ); ?></strong></label><br>
					<input type="number" id="kaizen-limit" name="kaizen_view[limit]" min="1" max="48" value="<?php echo esc_attr( $c['limit'] ); ?>" class="small-text">
				</p>
			</div>

			<div class="kaizen-row">
				<p>
					<strong><?php esc_html_e( 'Layout', 'kaizen-store' ); ?></strong><br>
					<label class="kaizen-radio"><input type="radio" name="kaizen_view[layout]" value="grid" <?php checked( $c['layout'], 'grid' ); ?>> <?php esc_html_e( 'Grid', 'kaizen-store' ); ?></label>
					<label class="kaizen-radio"><input type="radio" name="kaizen_view[layout]" value="carousel" <?php checked( $c['layout'], 'carousel' ); ?>> <?php esc_html_e( 'Carousel', 'kaizen-store' ); ?></label>
				</p>
				<p>
					<label for="kaizen-columns"><strong><?php esc_html_e( 'Columns (products side by side)', 'kaizen-store' ); ?></strong></label><br>
					<input type="number" id="kaizen-columns" name="kaizen_view[columns]" min="1" max="6" value="<?php echo esc_attr( $c['columns'] ); ?>" class="small-text">
				</p>
			</div>

			<fieldset class="kaizen-fieldset">
				<legend><strong><?php esc_html_e( 'Show', 'kaizen-store' ); ?></strong></legend>
				<label class="kaizen-radio"><input type="checkbox" name="kaizen_view[show_price]" value="1" <?php checked( $c['show_price'], 1 ); ?>> <?php esc_html_e( 'Price', 'kaizen-store' ); ?></label>
				<label class="kaizen-radio"><input type="checkbox" name="kaizen_view[show_excerpt]" value="1" <?php checked( $c['show_excerpt'], 1 ); ?>> <?php esc_html_e( 'Short description', 'kaizen-store' ); ?></label>
				<label class="kaizen-radio"><input type="checkbox" name="kaizen_view[show_button]" value="1" <?php checked( $c['show_button'], 1 ); ?>> <?php esc_html_e( 'Button', 'kaizen-store' ); ?></label>
				<label class="kaizen-radio"><input type="checkbox" name="kaizen_view[new_tab]" value="1" <?php checked( $c['new_tab'], 1 ); ?>> <?php esc_html_e( 'Open products in a new tab', 'kaizen-store' ); ?></label>
				<p>
					<label for="kaizen-button-text"><?php esc_html_e( 'Button words (leave empty for the market\'s language)', 'kaizen-store' ); ?></label><br>
					<input type="text" id="kaizen-button-text" name="kaizen_view[button_text]" maxlength="40" class="regular-text" value="<?php echo esc_attr( $c['button_text'] ); ?>">
				</p>
			</fieldset>

			<div class="kaizen-preview">
				<p><button type="button" class="button" data-preview><?php esc_html_e( 'Refresh preview', 'kaizen-store' ); ?></button></p>
				<div class="kaizen-preview-box" data-preview-box aria-live="polite"></div>
			</div>
		</div>
		<?php
	}

	/**
	 * Keeps what the editor posted. Only for a person who may manage the site, from the editor's own form.
	 *
	 * @param int     $post_id The view.
	 * @param WP_Post $post    The post.
	 */
	public static function save_view( $post_id, $post ) {
		if ( ! isset( $_POST['kaizen_store_view_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['kaizen_store_view_nonce'] ) ), 'kaizen_store_save_view' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'manage_options' ) || wp_is_post_revision( $post_id ) ) {
			return;
		}
		$posted = isset( $_POST['kaizen_view'] ) ? wp_unslash( $_POST['kaizen_view'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized by Kaizen_Store_Views::sanitize().
		Kaizen_Store_Views::save( $post_id, is_array( $posted ) ? $posted : array() );
	}

	// -------------------------------------------------------------------------------------------------------------
	// The editor's calls.
	// -------------------------------------------------------------------------------------------------------------

	private static function guard() {
		check_ajax_referer( 'kaizen_store_admin', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'You are not allowed to do that.', 'kaizen-store' ) ), 403 );
		}
	}

	private static function answer( $result ) {
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}
		wp_send_json_success( $result );
	}

	private static function posted_store() {
		$store = isset( $_POST['store'] ) ? sanitize_text_field( wp_unslash( $_POST['store'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- guard() checks the nonce.
		return preg_match( '/^[a-z0-9-]{3,40}$/', $store ) ? $store : '';
	}

	public static function ajax_stores() {
		self::guard();
		self::answer( Kaizen_Store_Api::stores() );
	}

	public static function ajax_terms() {
		self::guard();
		$store = self::posted_store();
		self::answer( '' === $store ? new WP_Error( 'kaizen_no_store', __( 'Choose a store first.', 'kaizen-store' ) ) : Kaizen_Store_Api::terms( $store ) );
	}

	public static function ajax_products() {
		self::guard();
		$store  = self::posted_store();
		$search = isset( $_POST['q'] ) ? mb_substr( sanitize_text_field( wp_unslash( $_POST['q'] ) ), 0, 80 ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		self::answer( '' === $store ? new WP_Error( 'kaizen_no_store', __( 'Choose a store first.', 'kaizen-store' ) ) : Kaizen_Store_Api::products( $store, $search ) );
	}

	public static function ajax_preview() {
		self::guard();
		$posted = isset( $_POST['config'] ) ? json_decode( wp_unslash( $_POST['config'] ), true ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$config = Kaizen_Store_Views::sanitize( is_array( $posted ) ? $posted : array() );
		wp_send_json_success( array( 'html' => Kaizen_Store_Render::render( $config, true ) ) );
	}
}
