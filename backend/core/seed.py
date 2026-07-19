"""Startup seeding: admin account + sample songs/gear/products/blog."""
import bcrypt
from core import db, ADMIN_EMAIL, ADMIN_PASSWORD, now_iso, logger, Song, Gear, DigitalProduct, BlogPost


async def seed_all():
    # Admin
    existing = await db.admins.find_one({"email": ADMIN_EMAIL}, {"_id": 0})
    if not existing:
        hashed = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
        await db.admins.insert_one({"email": ADMIN_EMAIL, "password_hash": hashed, "created_at": now_iso()})
        logger.info(f"Seeded admin {ADMIN_EMAIL}")

    # Songs
    if await db.songs.count_documents({}) == 0:
        sample_songs = [
            Song(title="Midnight Echo", artist="Triple Side", genre="Synthwave", duration="3:42",
                 cover_url="https://images.unsplash.com/photo-1518972559570-7cc1309f3229?w=800",
                 audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                 release_year=2024, description="A moody late night anthem."),
            Song(title="Neon Pulse", artist="Triple Side", genre="Electronic", duration="4:11",
                 cover_url="https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800",
                 audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                 release_year=2024, description="Driving electronic energy."),
            Song(title="Crimson Sky", artist="Triple Side ft. Aria", genre="Indie Pop", duration="3:28",
                 cover_url="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800",
                 audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
                 release_year=2023, description="Warm vocals over lush production."),
            Song(title="Glass Walls", artist="Triple Side", genre="Lo-Fi", duration="2:55",
                 cover_url="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800",
                 audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
                 release_year=2023, description="Chill lo-fi beats for late nights."),
            Song(title="Voltage", artist="Triple Side", genre="Techno", duration="5:02",
                 cover_url="https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=800",
                 audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
                 release_year=2024, description="High-voltage club energy."),
            Song(title="Soft Static", artist="Triple Side", genre="Ambient", duration="6:18",
                 cover_url="https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=800",
                 audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
                 release_year=2022, description="Cinematic ambient textures."),
            Song(title="Live at Loop Sessions", artist="Triple Side", genre="Live", duration="4:30",
                 cover_url="https://images.unsplash.com/photo-1501612780327-45045538702b?w=800",
                 audio_url="",
                 track_type="youtube",
                 embed_url="https://www.youtube.com/embed/dQw4w9WgXcQ",
                 release_year=2024, description="A live cut from our recent loop session."),
            Song(title="Blinding Lights — Studio Cover", artist="Triple Side", genre="Pop",
                 duration="3:20",
                 cover_url="https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?w=800",
                 audio_url="",
                 track_type="spotify",
                 embed_url="https://open.spotify.com/embed/track/0VjIjW4GlUZAMYd2vXMi3b",
                 release_year=2024, description="Our spin on the synthwave anthem."),
        ]
        await db.songs.insert_many([s.model_dump() for s in sample_songs])
        logger.info("Seeded sample songs")

    # Gear
    if await db.gear.count_documents({}) == 0:
        sample_gear = [
            Gear(name="Neumann U87 Ai", brand="Neumann", category="Microphone",
                 image_url="https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=900",
                 description="The industry-standard large diaphragm condenser microphone.",
                 specs=["Cardioid / Omni / Figure-8", "Frequency: 20Hz - 20kHz", "Self-noise: 12 dB-A"]),
            Gear(name="Universal Audio Apollo X8p", brand="Universal Audio", category="Audio Interface",
                 image_url="https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=900",
                 description="Thunderbolt 3 audio interface with HEXA Core processing.",
                 specs=["8 Unison Preamps", "24-bit / 192kHz", "Real-time UAD plugins"]),
            Gear(name="Yamaha HS8", brand="Yamaha", category="Studio Monitor",
                 image_url="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=900",
                 description="Two-way bass-reflex bi-amplified nearfield studio monitor.",
                 specs=["8-inch woofer", "120W bi-amplified", "38Hz - 30kHz"]),
            Gear(name="Moog Subsequent 37", brand="Moog", category="Synthesizer",
                 image_url="https://images.unsplash.com/photo-1520637836862-4d197d17c93a?w=900",
                 description="Paraphonic analog synthesizer with two oscillators.",
                 specs=["37 keys, semi-weighted", "2x Variable Wave Osc", "Ladder Filter"]),
            Gear(name="Fender Stratocaster", brand="Fender", category="Guitar",
                 image_url="https://images.unsplash.com/photo-1525201548942-d8732f6617a0?w=900",
                 description="American Professional II Stratocaster - the iconic electric guitar.",
                 specs=["Alder body", "V-Mod II pickups", "Maple neck"]),
            Gear(name="SSL Big Six", brand="Solid State Logic", category="Mixing Console",
                 image_url="https://images.unsplash.com/photo-1598653222000-6b7b7a552625?w=900",
                 description="SuperAnalogue 16-channel mixer with USB audio interface.",
                 specs=["4 SSL preamps", "Bus Compressor", "USB-C 16x16 I/O"]),
        ]
        await db.gear.insert_many([g.model_dump() for g in sample_gear])
        logger.info("Seeded sample gear")

    # Digital products
    if await db.products.count_documents({}) == 0:
        sample_products = [
            DigitalProduct(name="Midnight Vibes Sample Pack", category="Sample Pack",
                           image_url="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800",
                           description="60+ moody synthwave samples, loops and one-shots.",
                           price=19.99,
                           preview_audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                           download_url="midnight_vibes_pack.zip"),
            DigitalProduct(name="Analog Drums Vol.1", category="Drum Kit",
                           image_url="https://images.unsplash.com/photo-1519508234439-4f23643125c1?w=800",
                           description="Hand-crafted analog drum samples from our studio.",
                           price=14.99,
                           preview_audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                           download_url="analog_drums_v1.zip"),
            DigitalProduct(name="Serum Preset Bank: Neon", category="Presets",
                           image_url="https://images.unsplash.com/photo-1496293455970-f8581aae0e3b?w=800",
                           description="50 custom Serum presets for synthwave and retro pop.",
                           price=9.99,
                           preview_audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
                           download_url="serum_neon_presets.zip"),
            DigitalProduct(name="Vocal Chops Essentials", category="Sample Pack",
                           image_url="https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800",
                           description="120 royalty-free vocal chops, adlibs and textures.",
                           price=24.99,
                           preview_audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
                           download_url="vocal_chops_essentials.zip"),
            DigitalProduct(name="Mixing Template Pro", category="Project Template",
                           image_url="https://images.unsplash.com/photo-1487537023671-8dce1a785863?w=800",
                           description="Ableton Live mixing template used on our chart releases.",
                           price=29.99,
                           preview_audio_url="",
                           download_url="mixing_template_pro.zip"),
            DigitalProduct(name="Cinematic FX Library", category="Sound FX",
                           image_url="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800",
                           description="200 cinematic risers, impacts and atmospheres.",
                           price=34.99,
                           preview_audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
                           download_url="cinematic_fx_library.zip"),
            DigitalProduct(name="Free Starter Kit — 10 Drum Samples", category="Drum Kit",
                           image_url="https://images.unsplash.com/photo-1571974599782-87624638275e?w=800",
                           description="A free taste of our drum collection. Royalty-free for any project.",
                           price=0.0,
                           is_free=True,
                           preview_audio_url="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
                           download_url="free_starter_drums.zip"),
        ]
        await db.products.insert_many([p.model_dump() for p in sample_products])
        logger.info("Seeded sample products")

    # Blog posts
    if await db.blog_posts.count_documents({}) == 0:
        posts = [
            BlogPost(
                slug="welcome-to-tripleside",
                title="Welcome to TripleSide Studio",
                excerpt="A new home for our music, gear, and sound libraries. Here's what to expect.",
                content="""# Welcome

We're excited to open the doors to **triplesidestudio.com** — a single home for everything we make.

## What's inside

- **Songs catalog** with embedded YouTube & Spotify players
- **Gear we use** every day at the studio
- **Digital products** for producers: sample packs, presets, templates
- A growing **blog** with production tips and behind-the-scenes notes

## Stay in touch

More content drops every week. Bookmark the page and tell us what you'd like to read about next.
""",
                featured_image="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200",
                tags=["news", "studio"],
                status="published",
                published_at=now_iso(),
            ),
            BlogPost(
                slug="5-mixing-tips-from-the-studio",
                title="5 Mixing Tips From the Studio",
                excerpt="Quick wins to make your mixes translate better on any speaker.",
                content="""# 5 Mixing Tips

Tested on hundreds of sessions at TripleSide. Use them next time you open a project.

## 1. Reference loudness, not loudness alone
Loud isn't the goal — clarity at a target loudness is.

## 2. EQ in the context of the full mix
Solo EQ is misleading. Make decisions with everything playing.

## 3. Buss compression early
A 1–2 dB master buss compressor from session start glues everything as it grows.

## 4. Subtractive sidechain
Carve a notch around the kick instead of pumping the entire bass.

## 5. Listen on a phone
The phone speaker is brutal — and brutally honest.
""",
                featured_image="https://images.unsplash.com/photo-1487537023671-8dce1a785863?w=1200",
                tags=["mixing", "tips", "production"],
                status="published",
                published_at=now_iso(),
            ),
        ]
        await db.blog_posts.insert_many([p.model_dump() for p in posts])
        logger.info("Seeded sample blog posts")
