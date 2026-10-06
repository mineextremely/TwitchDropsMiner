'use strict';
'require view';
'require fs';
'require poll';
'require ui';
'require uci';

var INVENTORY_FILE = '/tmp/twitchdropsminer.inventory.json';

/* see overview.js - covers both the footstrap and the bootstrap label classes */
var LABEL_BAD = 'label danger important';

/*
 * Mirrors the desktop GUI's Inventory tab filter (gui.py InventoryOverview).
 * `not_linked` has no fixed default: the desktop seeds it from the priority
 * mode, so it is left null until the UCI settings have been loaded.
 *
 * Unlike the desktop, toggling a box re-filters immediately instead of waiting
 * for the Refresh button - the desktop's checkbuttons have no command binding
 * at all, which just makes them look broken.
 */
var filters = {
	not_linked: null,
	upcoming: true,
	expired: false,
	excluded: false,
	finished: false
};

/* the three settings the visibility rule needs, read from UCI */
var cfg = { exclude: [], priority: [], priority_only: true };

function loadConfig() {
	return uci.load('twitchdropsminer').then(function() {
		cfg.exclude = uci.get('twitchdropsminer', 'main', 'exclude') || [];
		cfg.priority = uci.get('twitchdropsminer', 'main', 'priority') || [];
		/* 0 = PriorityMode.PRIORITY_ONLY */
		cfg.priority_only = (uci.get('twitchdropsminer', 'main', 'priority_mode') || '0') == '0';

		if (filters.not_linked === null)
			filters.not_linked = cfg.priority_only;
	}).catch(function() {
		/* without UCI we can't tell which games are excluded or prioritised;
		   fall back to the defaults rather than failing the whole page */
		if (filters.not_linked === null)
			filters.not_linked = true;
	});
}

/*
 * The desktop's InventoryOverview._update_visibility, clause for clause.
 *
 * The "sub-only" test deserves a note: the desktop uses
 * `campaign.required_minutes > 0`, and DropsCampaign.required_minutes is
 * `max(d.total_required_minutes for d in drops)`, where a drop's total also
 * counts its precondition drops. Since preconditions are themselves drops of
 * the same campaign, "some drop needs minutes" and "the campaign's maximum is
 * positive" are the same statement - and the inventory export only carries the
 * per-drop `required_minutes`, so this is exact, not an approximation.
 */
function isVisible(campaign) {
	var drops = campaign.drops || [];
	var game = campaign.game || '';

	if (!drops.some(function(drop) { return (drop.required_minutes || 0) > 0; }))
		return false;

	if (!(filters.not_linked || campaign.eligible))
		return false;

	if (!(campaign.active ||
		(filters.upcoming && campaign.upcoming) ||
		(filters.expired && campaign.expired)))
		return false;

	/* (not excluded and not priority-only) or on the priority list -- and the
	   whole clause is short-circuited when the "Excluded" box is ticked */
	if (!(filters.excluded ||
		((cfg.exclude.indexOf(game) < 0 && !cfg.priority_only) ||
		 cfg.priority.indexOf(game) >= 0)))
		return false;

	if (!(filters.finished || !campaign.finished))
		return false;

	return true;
}

function readInventory() {
	return fs.read(INVENTORY_FILE).then(function(data) {
		try {
			return JSON.parse(data);
		}
		catch (e) {
			return null;
		}
	}).catch(function() {
		return null;
	});
}

function formatMinutes(minutes) {
	if (minutes == null || minutes < 0)
		return '-';

	var hours = Math.floor(minutes / 60), mins = minutes % 60;

	return hours > 0 ? '%dh %dm'.format(hours, mins) : '%dm'.format(mins);
}

function formatDate(iso) {
	if (!iso)
		return '-';

	var date = new Date(iso);

	return isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

/*
 * The boxart URLs carry a size suffix that Twitch's CDN honours, so ask for a
 * thumbnail instead of the full size image. Other URLs are used as they are.
 */
function thumbnail(url, width, height) {
	if (!url)
		return null;

	return url.replace(/(\/ttv-boxart\/[^\/]+?)(-\d+x\d+)?(\.[a-z]+)$/i,
		'$1-%dx%d$3'.format(width, height));
}

function image(url, width, height, alt) {
	if (!url)
		return E('div', {
			'style': 'width:%dpx; height:%dpx; background:#8883;'.format(width, height)
		});

	var img = E('img', {
		'src': url,
		'width': width,
		'height': height,
		'alt': alt || '',
		'loading': 'lazy',
		'style': 'object-fit:contain;'
	});

	/* a broken or blocked image should not leave a broken icon behind */
	img.onerror = function() {
		this.style.visibility = 'hidden';
	};

	return img;
}

function dropStatus(drop) {
	if (drop.is_claimed)
		return { text: _('Claimed') + ' ✓', style: 'color:green;' };

	if (drop.can_claim)
		return { text: _('Ready to claim'), style: 'color:goldenrod;' };

	if (drop.current_minutes > 0 || drop.can_earn)
		return {
			text: _('%d%% of %d minutes').format(
				Math.round((drop.progress || 0) * 100), drop.required_minutes
			),
			style: ''
		};

	/* drops that can't be earned (yet) - either upcoming, or subscription based */
	if (drop.required_minutes > 0)
		return {
			text: _('%d minutes').format(drop.required_minutes),
			style: 'color:#888;'
		};

	return { text: '', style: '' };
}

function renderDrop(drop, campaign) {
	var status = dropStatus(drop);
	var benefits = (drop.benefits || []).map(function(benefit) {
		return E('div', { 'style': 'text-align:center;' }, [
			image(benefit.image, 80, 80, benefit.name),
			E('div', { 'style': 'font-size:90%; max-width:9em; word-wrap:break-word;' }, benefit.name)
		]);
	});

	if (!benefits.length)
		benefits.push(E('div', {}, drop.name));

	return E('div', {
		'style': 'flex:0 0 auto; border:1px solid #8883; border-radius:4px; ' +
			'padding:6px; margin:4px; text-align:center; min-width:8em;'
	}, [
		E('div', { 'style': 'display:flex; justify-content:center; gap:6px;' }, benefits),
		E('div', { 'style': 'margin-top:6px; ' + status.style }, status.text),
		(drop.ends_at && drop.ends_at != campaign.ends_at)
			? E('div', { 'style': 'font-size:85%; color:#888;' },
				_('Ends: %s').format(formatDate(drop.ends_at)))
			: ''
	]);
}

function renderCampaign(campaign) {
	var labels = [];

	if (campaign.active)
		labels.push(E('span', { 'class': 'label success' }, _('Active')));
	else if (campaign.upcoming)
		labels.push(E('span', { 'class': 'label' }, _('Upcoming')));
	else
		labels.push(E('span', { 'class': LABEL_BAD }, _('Expired')));

	if (campaign.watching)
		labels.push(E('span', { 'class': 'label' }, '▶ ' + _('Mining now')));

	if (!campaign.eligible)
		labels.push(E('span', { 'class': LABEL_BAD }, _('Not linked')));

	var allowed = campaign.allowed_channels || [];
	var allowedText = allowed.length
		? (allowed.length <= 5
			? allowed.join(', ')
			: _('%s and %d more').format(allowed.slice(0, 4).join(', '), allowed.length - 4))
		: _('All channels');

	var drops = (campaign.drops || []).map(function(drop) {
		return renderDrop(drop, campaign);
	});

	return E('div', {
		'class': 'cbi-section',
		'style': 'border:1px solid #8883; border-radius:4px; padding:8px; margin-bottom:8px;'
	}, [
		E('div', { 'style': 'display:flex; gap:12px; align-items:flex-start;' }, [
			E('div', { 'style': 'flex:0 0 auto;' }, [
				image(thumbnail(campaign.image, 112, 144), 112, 144, campaign.game),
				E('div', { 'style': 'width:112px; margin-top:4px;' }, labels)
			]),
			E('div', { 'style': 'flex:1 1 auto; min-width:0;' }, [
				E('h4', { 'style': 'margin:0 0 4px 0;' }, campaign.name),
				E('div', { 'style': 'color:#888;' }, campaign.game || ''),
				E('div', {}, [ _('Ends: %s').format(formatDate(campaign.ends_at)) ]),
				E('div', {}, [ _('Allowed channels: %s').format(allowedText) ]),
				E('div', { 'style': 'margin-top:4px;' }, [
					_('%d/%d drops claimed').format(campaign.claimed_drops, campaign.total_drops),
					(campaign.total_drops
						? ' • ' + _('%d%% complete').format(Math.round((campaign.progress || 0) * 100))
						: ''),
					(campaign.remaining_minutes
						? ' • ' + _('%s remaining').format(formatMinutes(campaign.remaining_minutes))
						: '')
				])
			])
		]),
		E('div', {
			'style': 'display:flex; flex-wrap:wrap; overflow-x:auto; margin-top:6px;'
		}, drops)
	]);
}

return view.extend({
	load: function() {
		return loadConfig();
	},

	render: function() {
		var self = this;
		var summaryEl = E('div', {}, _('Loading...'));
		var listEl = E('div', {}, '');
		var inventory = null;

		function filterBox(key, label) {
			var box = E('input', { 'type': 'checkbox' });

			box.checked = !!filters[key];
			box.addEventListener('change', function() {
				filters[key] = box.checked;
				renderList();
			});

			return E('label', { 'style': 'margin-right:1.25em; white-space:nowrap;' },
				[ box, ' ', label ]);
		}

		function renderList() {
			while (listEl.firstChild)
				listEl.removeChild(listEl.firstChild);
			while (summaryEl.firstChild)
				summaryEl.removeChild(summaryEl.firstChild);

			if (inventory == null) {
				summaryEl.textContent =
					_('No inventory available yet - the miner is not running.');
				return;
			}

			var all = inventory.campaigns || [];
			var shown = all.filter(isVisible);
			var claimed = 0, total = 0;

			shown.forEach(function(c) {
				claimed += c.claimed_drops || 0;
				total += c.total_drops || 0;
			});

			summaryEl.appendChild(E('p', {}, (shown.length === all.length
				? _('%d campaigns • %d/%d drops claimed').format(shown.length, claimed, total)
				: _('%d of %d campaigns • %d/%d drops claimed')
					.format(shown.length, all.length, claimed, total))));

			if (!all.length) {
				listEl.appendChild(E('p', {}, _('No campaigns available.')));
				return;
			}
			if (!shown.length) {
				listEl.appendChild(E('p', {}, _('No campaigns match the current filter.')));
				return;
			}
			/* NOTE: the miner exports the campaigns in display order
			   (being mined first, then active, upcoming and the rest) */
			shown.forEach(function(campaign) {
				listEl.appendChild(renderCampaign(campaign));
			});
		}

		function refresh() {
			return readInventory().then(function(inv) {
				inventory = inv;
				renderList();
			});
		}

		poll.add(refresh, 10);
		refresh();

		return E([], [
			E('h2', {}, _('Twitch Drops Miner - Inventory')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Filter')),
				E('div', { 'style': 'display:flex; flex-wrap:wrap; align-items:center;' }, [
					E('span', { 'style': 'margin-right:0.75em;' }, _('Show:')),
					filterBox('not_linked', _('Not linked')),
					filterBox('upcoming', _('Upcoming')),
					filterBox('expired', _('Expired')),
					filterBox('excluded', _('Excluded')),
					filterBox('finished', _('Finished')),
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': ui.createHandlerFn(self, refresh)
					}, _('Refresh'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-descr' }, [
					_('All campaigns the miner knows about, with the progress of every drop. ' +
					  'Claiming is automatic - drops are collected as soon as they are finished.')
				]),
				summaryEl
			]),
			listEl
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
