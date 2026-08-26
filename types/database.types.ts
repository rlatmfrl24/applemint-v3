export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	public: {
		Tables: {
			crawl_alert_incidents: {
				Row: {
					active_signals: string[];
					id: number;
					last_observed_at: string;
					opened_at: string;
					recovered_at: string | null;
					snapshot: Json;
					source: string;
					status: string;
				};
				Insert: {
					active_signals: string[];
					id?: number;
					last_observed_at: string;
					opened_at: string;
					recovered_at?: string | null;
					snapshot?: Json;
					source: string;
					status?: string;
				};
				Update: {
					active_signals?: string[];
					id?: number;
					last_observed_at?: string;
					opened_at?: string;
					recovered_at?: string | null;
					snapshot?: Json;
					source?: string;
					status?: string;
				};
				Relationships: [
					{
						foreignKeyName: "crawl_alert_incidents_source_fkey";
						columns: ["source"];
						isOneToOne: false;
						referencedRelation: "crawl_source_registry";
						referencedColumns: ["source"];
					},
				];
			};
			crawl_alert_settings: {
				Row: {
					id: boolean;
					last_evaluated_at: string | null;
					no_success_seconds: number;
					parser_drop_ratio: number;
					parser_drop_streak: number;
					parser_failure_streak: number;
					transport_error_ratio: number;
					transport_min_failures: number;
					transport_window: number;
				};
				Insert: {
					id?: boolean;
					last_evaluated_at?: string | null;
					no_success_seconds?: number;
					parser_drop_ratio?: number;
					parser_drop_streak?: number;
					parser_failure_streak?: number;
					transport_error_ratio?: number;
					transport_min_failures?: number;
					transport_window?: number;
				};
				Update: {
					id?: boolean;
					last_evaluated_at?: string | null;
					no_success_seconds?: number;
					parser_drop_ratio?: number;
					parser_drop_streak?: number;
					parser_failure_streak?: number;
					transport_error_ratio?: number;
					transport_min_failures?: number;
					transport_window?: number;
				};
				Relationships: [];
			};
			crawl_run_locks: {
				Row: {
					lock_key: string;
					lock_token: string;
					locked_until: string;
					updated_at: string;
				};
				Insert: {
					lock_key: string;
					lock_token: string;
					locked_until: string;
					updated_at?: string;
				};
				Update: {
					lock_key?: string;
					lock_token?: string;
					locked_until?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			crawl_runs: {
				Row: {
					attempted_count: number;
					duration_ms: number | null;
					error_message: string | null;
					error_stage: string | null;
					extracted_count: number;
					failure_count: number;
					failures: Json;
					finished_at: string | null;
					id: number;
					inserted_count: number;
					last_heartbeat_at: string | null;
					lock_token: string;
					network_failure_count: number;
					parser_failure_count: number;
					parser_minimum_count: number;
					parser_observations: Json;
					parser_valid_count: number;
					recovered_count: number;
					retry_count: number;
					run_trigger: string;
					skipped_count: number;
					source: string;
					stale_after: string;
					started_at: string;
					status: string;
					succeeded_count: number;
					timeout_failure_count: number;
					warning_count: number;
					warnings: Json;
				};
				Insert: {
					attempted_count?: number;
					duration_ms?: number | null;
					error_message?: string | null;
					error_stage?: string | null;
					extracted_count?: number;
					failure_count?: number;
					failures?: Json;
					finished_at?: string | null;
					id?: number;
					inserted_count?: number;
					last_heartbeat_at?: string | null;
					lock_token: string;
					network_failure_count?: number;
					parser_failure_count?: number;
					parser_minimum_count?: number;
					parser_observations?: Json;
					parser_valid_count?: number;
					recovered_count?: number;
					retry_count?: number;
					run_trigger?: string;
					skipped_count?: number;
					source: string;
					stale_after: string;
					started_at?: string;
					status?: string;
					succeeded_count?: number;
					timeout_failure_count?: number;
					warning_count?: number;
					warnings?: Json;
				};
				Update: {
					attempted_count?: number;
					duration_ms?: number | null;
					error_message?: string | null;
					error_stage?: string | null;
					extracted_count?: number;
					failure_count?: number;
					failures?: Json;
					finished_at?: string | null;
					id?: number;
					inserted_count?: number;
					last_heartbeat_at?: string | null;
					lock_token?: string;
					network_failure_count?: number;
					parser_failure_count?: number;
					parser_minimum_count?: number;
					parser_observations?: Json;
					parser_valid_count?: number;
					recovered_count?: number;
					retry_count?: number;
					run_trigger?: string;
					skipped_count?: number;
					source?: string;
					stale_after?: string;
					started_at?: string;
					status?: string;
					succeeded_count?: number;
					timeout_failure_count?: number;
					warning_count?: number;
					warnings?: Json;
				};
				Relationships: [
					{
						foreignKeyName: "crawl_runs_source_fkey";
						columns: ["source"];
						isOneToOne: false;
						referencedRelation: "crawl_source_registry";
						referencedColumns: ["source"];
					},
				];
			};
			crawl_runtime_settings: {
				Row: {
					heartbeat_interval_seconds: number;
					id: boolean;
					lock_ttl_seconds: number;
					max_concurrency: number;
					scheduler_enabled: boolean;
					updated_at: string;
				};
				Insert: {
					heartbeat_interval_seconds?: number;
					id?: boolean;
					lock_ttl_seconds?: number;
					max_concurrency?: number;
					scheduler_enabled?: boolean;
					updated_at?: string;
				};
				Update: {
					heartbeat_interval_seconds?: number;
					id?: boolean;
					lock_ttl_seconds?: number;
					max_concurrency?: number;
					scheduler_enabled?: boolean;
					updated_at?: string;
				};
				Relationships: [];
			};
			crawl_schedule_dispatches: {
				Row: {
					admission_reason: string | null;
					created_at: string;
					http_status: number | null;
					id: number;
					request_id: number | null;
					resolved_at: string | null;
					response_body: Json | null;
					run_id: number | null;
					scheduled_for: string;
					source: string;
					state: string;
				};
				Insert: {
					admission_reason?: string | null;
					created_at?: string;
					http_status?: number | null;
					id?: never;
					request_id?: number | null;
					resolved_at?: string | null;
					response_body?: Json | null;
					run_id?: number | null;
					scheduled_for: string;
					source: string;
					state?: string;
				};
				Update: {
					admission_reason?: string | null;
					created_at?: string;
					http_status?: number | null;
					id?: never;
					request_id?: number | null;
					resolved_at?: string | null;
					response_body?: Json | null;
					run_id?: number | null;
					scheduled_for?: string;
					source?: string;
					state?: string;
				};
				Relationships: [
					{
						foreignKeyName: "crawl_schedule_dispatches_run_id_fkey";
						columns: ["run_id"];
						isOneToOne: false;
						referencedRelation: "crawl_runs";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "crawl_schedule_dispatches_source_fkey";
						columns: ["source"];
						isOneToOne: false;
						referencedRelation: "crawl_source_registry";
						referencedColumns: ["source"];
					},
				];
			};
			crawl_source_policies: {
				Row: {
					cooldown_seconds: number;
					recommended_cooldown_seconds: number;
					run_budget_seconds: number;
					schedule_enabled: boolean;
					source: string;
					updated_at: string;
				};
				Insert: {
					cooldown_seconds?: number;
					recommended_cooldown_seconds?: number;
					run_budget_seconds?: number;
					schedule_enabled?: boolean;
					source: string;
					updated_at?: string;
				};
				Update: {
					cooldown_seconds?: number;
					recommended_cooldown_seconds?: number;
					run_budget_seconds?: number;
					schedule_enabled?: boolean;
					source?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "crawl_source_policies_source_fkey";
						columns: ["source"];
						isOneToOne: true;
						referencedRelation: "crawl_source_registry";
						referencedColumns: ["source"];
					},
				];
			};
			crawl_source_registry: {
				Row: {
					active: boolean;
					created_at: string;
					label: string;
					retired_at: string | null;
					source: string;
					updated_at: string;
				};
				Insert: {
					active: boolean;
					created_at?: string;
					label: string;
					retired_at?: string | null;
					source: string;
					updated_at?: string;
				};
				Update: {
					active?: boolean;
					created_at?: string;
					label?: string;
					retired_at?: string | null;
					source?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			"crawl-history": {
				Row: {
					crawl_source: string;
					created_at: string;
					host: string | null;
					id: number;
					url: string;
				};
				Insert: {
					crawl_source: string;
					created_at?: string;
					host?: string | null;
					id?: number;
					url: string;
				};
				Update: {
					crawl_source?: string;
					created_at?: string;
					host?: string | null;
					id?: number;
					url?: string;
				};
				Relationships: [
					{
						foreignKeyName: "crawl_history_source_fkey";
						columns: ["crawl_source"];
						isOneToOne: false;
						referencedRelation: "crawl_source_registry";
						referencedColumns: ["source"];
					},
				];
			};
			"filter-keyword": {
				Row: {
					created_at: string;
					id: number;
					method: string;
					value: string;
				};
				Insert: {
					created_at?: string;
					id?: number;
					method: string;
					value: string;
				};
				Update: {
					created_at?: string;
					id?: number;
					method?: string;
					value?: string;
				};
				Relationships: [];
			};
			media_enrichment_jobs: {
				Row: {
					attempt_count: number;
					available_at: string;
					created_at: string;
					last_error_code: string | null;
					lease_expires_at: string | null;
					lease_token: string | null;
					provider: string;
					state: string;
					thread_id: number;
					updated_at: string;
				};
				Insert: {
					attempt_count?: number;
					available_at?: string;
					created_at?: string;
					last_error_code?: string | null;
					lease_expires_at?: string | null;
					lease_token?: string | null;
					provider: string;
					state?: string;
					thread_id: number;
					updated_at?: string;
				};
				Update: {
					attempt_count?: number;
					available_at?: string;
					created_at?: string;
					last_error_code?: string | null;
					lease_expires_at?: string | null;
					lease_token?: string | null;
					provider?: string;
					state?: string;
					thread_id?: number;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "media_enrichment_jobs_thread_id_fkey";
						columns: ["thread_id"];
						isOneToOne: true;
						referencedRelation: "thread_media_metadata";
						referencedColumns: ["thread_id"];
					},
				];
			};
			media_worker_dispatches: {
				Row: {
					claimed_count: number | null;
					created_at: string;
					failed_count: number | null;
					http_status: number | null;
					id: number;
					lease_rejected_count: number | null;
					provider: string;
					ready_count: number | null;
					request_id: number | null;
					resolved_at: string | null;
					response_reason: string | null;
					retried_count: number | null;
					scheduled_for: string;
					state: string;
					unavailable_count: number | null;
					unsupported_count: number | null;
				};
				Insert: {
					claimed_count?: number | null;
					created_at?: string;
					failed_count?: number | null;
					http_status?: number | null;
					id?: never;
					lease_rejected_count?: number | null;
					provider: string;
					ready_count?: number | null;
					request_id?: number | null;
					resolved_at?: string | null;
					response_reason?: string | null;
					retried_count?: number | null;
					scheduled_for: string;
					state?: string;
					unavailable_count?: number | null;
					unsupported_count?: number | null;
				};
				Update: {
					claimed_count?: number | null;
					created_at?: string;
					failed_count?: number | null;
					http_status?: number | null;
					id?: never;
					lease_rejected_count?: number | null;
					provider?: string;
					ready_count?: number | null;
					request_id?: number | null;
					resolved_at?: string | null;
					response_reason?: string | null;
					retried_count?: number | null;
					scheduled_for?: string;
					state?: string;
					unavailable_count?: number | null;
					unsupported_count?: number | null;
				};
				Relationships: [];
			};
			media_worker_runtime_settings: {
				Row: {
					id: boolean;
					scheduler_enabled: boolean;
					updated_at: string;
					youtube_batch_size: number;
					youtube_enabled: boolean;
				};
				Insert: {
					id?: boolean;
					scheduler_enabled?: boolean;
					updated_at?: string;
					youtube_batch_size?: number;
					youtube_enabled?: boolean;
				};
				Update: {
					id?: boolean;
					scheduler_enabled?: boolean;
					updated_at?: string;
					youtube_batch_size?: number;
					youtube_enabled?: boolean;
				};
				Relationships: [];
			};
			thread_media_metadata: {
				Row: {
					channel_title: string | null;
					created_at: string;
					duration_seconds: number | null;
					external_id: string | null;
					fetched_at: string | null;
					last_error_code: string | null;
					live_status: string | null;
					media_kind: string | null;
					provider: string;
					status: string;
					thread_id: number;
					thumbnail_url: string | null;
					title: string | null;
					updated_at: string;
				};
				Insert: {
					channel_title?: string | null;
					created_at?: string;
					duration_seconds?: number | null;
					external_id?: string | null;
					fetched_at?: string | null;
					last_error_code?: string | null;
					live_status?: string | null;
					media_kind?: string | null;
					provider: string;
					status?: string;
					thread_id: number;
					thumbnail_url?: string | null;
					title?: string | null;
					updated_at?: string;
				};
				Update: {
					channel_title?: string | null;
					created_at?: string;
					duration_seconds?: number | null;
					external_id?: string | null;
					fetched_at?: string | null;
					last_error_code?: string | null;
					live_status?: string | null;
					media_kind?: string | null;
					provider?: string;
					status?: string;
					thread_id?: number;
					thumbnail_url?: string | null;
					title?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "thread_media_metadata_thread_id_fkey";
						columns: ["thread_id"];
						isOneToOne: true;
						referencedRelation: "threads";
						referencedColumns: ["id"];
					},
				];
			};
			threads: {
				Row: {
					captured_at: string;
					created_at: string;
					description: string | null;
					host: string | null;
					id: number;
					state: string;
					state_changed_at: string;
					tag: string[] | null;
					title: string | null;
					type: string;
					url: string;
				};
				Insert: {
					captured_at?: string;
					created_at?: string;
					description?: string | null;
					host?: string | null;
					id?: number;
					state?: string;
					state_changed_at?: string;
					tag?: string[] | null;
					title?: string | null;
					type?: string;
					url: string;
				};
				Update: {
					captured_at?: string;
					created_at?: string;
					description?: string | null;
					host?: string | null;
					id?: number;
					state?: string;
					state_changed_at?: string;
					tag?: string[] | null;
					title?: string | null;
					type?: string;
					url?: string;
				};
				Relationships: [];
			};
			web_push_deliveries: {
				Row: {
					attempt_count: number;
					available_at: string;
					created_at: string;
					delivered_at: string | null;
					id: number;
					inserted_count: number;
					last_error_code: string | null;
					lease_expires_at: string | null;
					lease_token: string | null;
					run_id: number;
					source: string;
					state: string;
					subscription_id: number;
					updated_at: string;
				};
				Insert: {
					attempt_count?: number;
					available_at?: string;
					created_at?: string;
					delivered_at?: string | null;
					id?: number;
					inserted_count: number;
					last_error_code?: string | null;
					lease_expires_at?: string | null;
					lease_token?: string | null;
					run_id: number;
					source: string;
					state?: string;
					subscription_id: number;
					updated_at?: string;
				};
				Update: {
					attempt_count?: number;
					available_at?: string;
					created_at?: string;
					delivered_at?: string | null;
					id?: number;
					inserted_count?: number;
					last_error_code?: string | null;
					lease_expires_at?: string | null;
					lease_token?: string | null;
					run_id?: number;
					source?: string;
					state?: string;
					subscription_id?: number;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "web_push_deliveries_run_id_fkey";
						columns: ["run_id"];
						isOneToOne: false;
						referencedRelation: "crawl_runs";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "web_push_deliveries_source_fkey";
						columns: ["source"];
						isOneToOne: false;
						referencedRelation: "crawl_source_registry";
						referencedColumns: ["source"];
					},
					{
						foreignKeyName: "web_push_deliveries_subscription_id_fkey";
						columns: ["subscription_id"];
						isOneToOne: false;
						referencedRelation: "web_push_subscriptions";
						referencedColumns: ["id"];
					},
				];
			};
			web_push_subscriptions: {
				Row: {
					active: boolean;
					auth: string;
					created_at: string;
					disabled_at: string | null;
					endpoint: string;
					expiration_time: string | null;
					id: number;
					last_seen_at: string;
					last_test_requested_at: string | null;
					p256dh: string;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					active?: boolean;
					auth: string;
					created_at?: string;
					disabled_at?: string | null;
					endpoint: string;
					expiration_time?: string | null;
					id?: number;
					last_seen_at?: string;
					last_test_requested_at?: string | null;
					p256dh: string;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					active?: boolean;
					auth?: string;
					created_at?: string;
					disabled_at?: string | null;
					endpoint?: string;
					expiration_time?: string | null;
					id?: number;
					last_seen_at?: string;
					last_test_requested_at?: string | null;
					p256dh?: string;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			_begin_crawl_run: {
				Args: {
					p_lock_token: string;
					p_source: string;
					p_trigger: string;
					p_ttl_seconds: number;
				};
				Returns: Json;
			};
			_crawl_next_dispatch_at: { Args: { p_value: string }; Returns: string };
			_select_due_crawl_sources: {
				Args: { p_limit: number; p_now: string; p_scheduled_for: string };
				Returns: {
					last_finished_at: string;
					source: string;
				}[];
			};
			acknowledge_web_push_inbox: {
				Args: { p_endpoint: string };
				Returns: Json;
			};
			acquire_crawl_lock: {
				Args: {
					p_lock_key: string;
					p_lock_token: string;
					p_ttl_seconds?: number;
				};
				Returns: boolean;
			};
			begin_crawl_run: {
				Args: { p_lock_token: string; p_source: string; p_ttl_seconds?: number };
				Returns: Json;
			};
			begin_scheduled_crawl_run: {
				Args: { p_lock_token: string; p_source: string; p_ttl_seconds?: number };
				Returns: Json;
			};
			bulk_move_inbox_to_trash: { Args: never; Returns: number };
			claim_media_enrichment_jobs: {
				Args: { p_lease_seconds: number; p_limit: number; p_provider: string };
				Returns: {
					attempt_count: number;
					lease_expires_at: string;
					lease_token: string;
					provider: string;
					thread_id: number;
					url: string;
				}[];
			};
			claim_web_push_deliveries: {
				Args: { p_lease_seconds?: number; p_limit?: number };
				Returns: {
					auth: string;
					badge_count: number;
					created_at: string;
					delivery_id: number;
					delivery_lease_token: string;
					endpoint: string;
					expiration_time: string;
					inserted_count: number;
					p256dh: string;
					run_id: string;
					source: string;
					subscription_id: number;
				}[];
			};
			claim_web_push_test_subscription: {
				Args: { p_cooldown_seconds?: number; p_endpoint: string };
				Returns: Json;
			};
			clean_trash: { Args: never; Returns: undefined };
			cleanup_crawl_runs: { Args: never; Returns: number };
			cleanup_crawl_schedule_dispatches: { Args: never; Returns: number };
			cleanup_cron_job_run_details: { Args: never; Returns: number };
			cleanup_media_worker_dispatches: { Args: never; Returns: number };
			cleanup_web_push_notifications: { Args: never; Returns: Json };
			complete_media_enrichment_job: {
				Args: { p_lease_token: string; p_metadata: Json; p_thread_id: number };
				Returns: boolean;
			};
			complete_web_push_delivery: {
				Args: { p_delivery_id: number; p_lease_token: string };
				Returns: boolean;
			};
			disable_web_push_subscription: {
				Args: { p_endpoint: string };
				Returns: Json;
			};
			dispatch_due_crawl_sources: { Args: never; Returns: Json };
			dispatch_due_media_enrichment_workers: { Args: never; Returns: Json };
			dispatch_due_web_push_notifications: { Args: never; Returns: Json };
			evaluate_crawl_alerts: { Args: { p_now?: string }; Returns: Json };
			fail_media_enrichment_job: {
				Args: {
					p_error_code: string;
					p_lease_token: string;
					p_thread_id: number;
				};
				Returns: boolean;
			};
			fail_web_push_delivery: {
				Args: {
					p_delivery_id: number;
					p_error_code: string;
					p_lease_token: string;
				};
				Returns: boolean;
			};
			finish_crawl_run: {
				Args: { p_lock_token: string; p_result: Json; p_run_id: number };
				Returns: Json;
			};
			get_active_crawl_source_registry: {
				Args: never;
				Returns: {
					label: string;
					source: string;
				}[];
			};
			get_crawl_alerts_dashboard: { Args: never; Returns: Json };
			get_crawl_runs_dashboard: {
				Args: { p_limit?: number; p_trend_limit?: number };
				Returns: Json;
			};
			get_crawl_source_policy_settings: { Args: never; Returns: Json };
			get_crawl_source_registry: { Args: never; Returns: Json };
			get_normal_site_stats: {
				Args: never;
				Returns: {
					count: number;
					site_key: string;
				}[];
			};
			get_thread_stats: {
				Args: { p_filter_type?: string; p_state: string };
				Returns: {
					count: number;
					key: string;
					label: string;
					total_count: number;
				}[];
			};
			get_thread_stats_with_normal_sites: {
				Args: { p_filter_type?: string; p_state: string };
				Returns: Json;
			};
			get_web_push_subscription_status: {
				Args: { p_endpoint: string };
				Returns: Json;
			};
			heartbeat_crawl_run: {
				Args: { p_lock_token: string; p_run_id: number };
				Returns: Json;
			};
			ingest_crawl_items: {
				Args: { p_crawl_source: string; p_items: Json };
				Returns: Json;
			};
			invalidate_web_push_subscription: {
				Args: {
					p_delivery_id: number;
					p_error_code: string;
					p_lease_token: string;
				};
				Returns: Json;
			};
			invalidate_web_push_test_subscription: {
				Args: { p_error_code: string; p_subscription_id: number };
				Returns: Json;
			};
			is_applemint_owner: { Args: never; Returns: boolean };
			list_threads_page: {
				Args: {
					p_cursor_id?: number;
					p_cursor_state_changed_at?: string;
					p_filter_site?: string;
					p_filter_type?: string;
					p_limit?: number;
					p_state: string;
				};
				Returns: {
					captured_at: string;
					created_at: string;
					description: string;
					host: string;
					id: string;
					media_metadata: Json;
					state: string;
					state_changed_at: string;
					tag: string[];
					title: string;
					type: string;
					url: string;
				}[];
			};
			normalize_normal_site_key: { Args: { p_host: string }; Returns: string };
			reconcile_crawl_schedule_dispatches: { Args: never; Returns: number };
			reconcile_media_worker_dispatches: { Args: never; Returns: number };
			record_crawl_run_contract_failure: {
				Args: {
					p_error_message: string;
					p_error_stage: string;
					p_lock_token: string;
					p_run_id: number;
				};
				Returns: boolean;
			};
			recover_stale_crawl_runs: { Args: never; Returns: number };
			release_crawl_lock: {
				Args: { p_lock_key: string; p_lock_token: string };
				Returns: boolean;
			};
			retry_media_enrichment_job: {
				Args: {
					p_available_at: string;
					p_error_code: string;
					p_lease_token: string;
					p_thread_id: number;
				};
				Returns: boolean;
			};
			retry_web_push_delivery: {
				Args: {
					p_delivery_id: number;
					p_error_code: string;
					p_lease_token: string;
				};
				Returns: Json;
			};
			transition_thread_state: {
				Args: {
					p_destination_state: string;
					p_expected_state: string;
					p_thread_id: number;
				};
				Returns: Json;
			};
			update_crawl_source_policy: {
				Args: {
					p_cooldown_seconds: number;
					p_expected_updated_at: string;
					p_schedule_enabled: boolean;
					p_source: string;
				};
				Returns: Json;
			};
			upsert_web_push_subscription: {
				Args: {
					p_auth: string;
					p_endpoint: string;
					p_expiration_time?: string;
					p_p256dh: string;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};
